"""Minimal ONNX runner for the Kokoro-82M v1.0 quantized export bundled in expo-kokoro.

Why not kokoro-onnx? kokoro-onnx 0.6.1 does handle this graph (it detects the
``input_ids`` input name and the float ``speed`` input), but it loads voices with
``np.load`` from one .npz archive, while expo-kokoro ships one raw float32 file per
voice, and its G2P is plain espeak IPA without misaki's symbol mapping that v1.0
was trained on. The runner below is the ~100 lines of it we actually need.

Graph contract (checked at load time):
    input_ids int64  [1, n+2]  phoneme ids wrapped in pad id 0 at both ends
    style     float32 [1, 256] row of the voice pack chosen by phoneme count
    speed     float32 [1]      duration scale, 1.0 = native pace, <1 slower
    waveform  float32 [1, samples] at 24 kHz
The graph contains no random ops, so a given input always gives the same output
(checked by the self-test in build_narration.py --selftest).
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from . import paths

SAMPLE_RATE = 24_000
STYLE_DIM = 256
VOICE_ROWS = 510          # voice packs are float32 [510, 1, 256]
MAX_TOKENS = 510          # context 512 minus the two pad ids
EMBEDDING_ROWS = 178      # rows of encoder.*.embedding.weight in this export
PAD_ID = 0
FRAME_SAMPLES = 600       # one duration-predictor frame = 25 ms at 24 kHz


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_lock() -> dict:
    if not paths.LOCK.exists():
        raise SystemExit("model-lock.json not found: run ./setup.sh and fetch_model.py first")
    return json.loads(paths.LOCK.read_text())


def load_vocab(tokenizer_json: Path) -> dict[str, int]:
    """Phoneme symbol -> id from the tokenizer.json shipped next to the model."""
    cfg = json.loads(Path(tokenizer_json).read_text(encoding="utf-8"))
    vocab = {k: int(v) for k, v in cfg["model"]["vocab"].items() if k != "$"}
    if not vocab or max(vocab.values()) >= EMBEDDING_ROWS or min(vocab.values()) <= PAD_ID:
        raise SystemExit(f"vocab ids out of range for a {EMBEDDING_ROWS}-row embedding")
    if len(set(vocab.values())) != len(vocab):
        raise SystemExit("vocab has duplicate ids")
    return vocab


@dataclass
class SynthResult:
    audio: np.ndarray        # float32 mono, 24 kHz, raw model output
    n_tokens: int
    style_row: int
    seconds: float           # wall-clock inference time
    dropped: str             # phoneme characters not in the vocab (removed)
    durations: list[int] | None = None  # frames (FRAME_SAMPLES each) per token, pads included


ENGINES = ("float-conv", "quantized")


class Kokoro:
    """Kokoro-82M v1.0 on onnxruntime (CPU).

    engine="float-conv" (default) runs narr/derive.py's rewrite of the bundled graph
    (same 8-bit weights, float convolutions; ~4.5x faster on the build machine);
    engine="quantized" runs the bundled kokoro-quantized.onnx exactly as shipped.
    """

    def __init__(self, threads: int = 4, engine: str = "float-conv", verify: bool = True):
        if engine not in ENGINES:
            raise SystemExit(f"unknown engine {engine!r}; choose from {ENGINES}")
        lock = load_lock()
        self.lock = lock
        self.source_path = paths.HERE / lock["model"]["file"]
        self.source_sha256 = lock["model"]["sha256"]
        if not self.source_path.exists():
            raise SystemExit(f"{self.source_path} missing: run fetch_model.py")
        if verify and sha256_file(self.source_path) != self.source_sha256:
            raise SystemExit(f"{self.source_path} does not match model-lock.json; re-run fetch_model.py")
        vocab_entry = next(f for f in lock["files"] if f["path"].endswith("build/tokenizer.json"))
        self.vocab = load_vocab(paths.HERE / vocab_entry["dest"])
        self.threads = threads
        self.engine = engine
        if engine == "float-conv":
            from . import derive

            self.model_path, self.engine_sha256 = derive.ensure(self.source_path, self.source_sha256)
            if verify and sha256_file(self.model_path) != self.engine_sha256:
                raise SystemExit(f"{self.model_path} is corrupt; delete it to rebuild")
        else:
            self.model_path, self.engine_sha256 = self.source_path, self.source_sha256

        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.use_deterministic_compute = True
        so.log_severity_level = 3
        from .derive import DURATION_OUTPUT, with_duration_output

        if engine == "float-conv":
            self.sess = ort.InferenceSession(str(self.model_path), so, providers=["CPUExecutionProvider"])
        else:  # the bundled graph, with only the duration output added (in memory)
            self.sess = ort.InferenceSession(with_duration_output(self.model_path), so,
                                             providers=["CPUExecutionProvider"])
        ins = {i.name: i for i in self.sess.get_inputs()}
        outs = [o.name for o in self.sess.get_outputs()]
        expected = {"input_ids": "tensor(int64)", "style": "tensor(float)", "speed": "tensor(float)"}
        for name, typ in expected.items():
            if name not in ins or ins[name].type != typ:
                raise SystemExit(f"unexpected model input signature: {[(i.name, i.type) for i in ins.values()]}")
        if outs[:1] != ["waveform"]:
            raise SystemExit(f"unexpected model outputs: {outs}")
        self._outputs = ["waveform"] + ([DURATION_OUTPUT] if DURATION_OUTPUT in outs else [])
        self._voices: dict[str, tuple[np.ndarray, str]] = {}

    # -- voices -----------------------------------------------------------------------
    def voice(self, voice_id: str) -> tuple[np.ndarray, str]:
        """Return (pack [510, 1, 256], sha256) for a voice extracted by fetch_model.py."""
        if voice_id not in self._voices:
            entry = next((f for f in self.lock["files"]
                          if f["path"].endswith(f"/voices/{voice_id}.bin")), None)
            if entry is None:
                raise SystemExit(f"voice {voice_id!r} not extracted; run fetch_model.py --voices {voice_id}")
            path = paths.HERE / entry["dest"]
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                raise SystemExit(f"{path} does not match model-lock.json")
            pack = np.frombuffer(raw, dtype="<f4").reshape(VOICE_ROWS, 1, STYLE_DIM).astype(np.float32)
            if not np.isfinite(pack).all():
                raise SystemExit(f"{path} contains non-finite values")
            self._voices[voice_id] = (pack, entry["sha256"])
        return self._voices[voice_id]

    # -- tokens -----------------------------------------------------------------------
    def tokenize(self, phonemes: str) -> tuple[list[int], str]:
        ids, dropped = [], []
        for ch in phonemes:
            i = self.vocab.get(ch)
            if i is None:
                dropped.append(ch)
            else:
                ids.append(i)
        return ids, "".join(dropped)

    @staticmethod
    def style_row(n_tokens: int) -> int:
        # hexgrad/kokoro KPipeline.infer uses pack[len(ps) - 1]: n phonemes -> row n-1.
        # (kokoro-onnx 0.6.1 does the same. The onnx-community README example indexes
        # voices[len(tokens)], one row later; neighbouring rows differ very little.)
        return max(0, min(n_tokens, VOICE_ROWS) - 1)

    # -- inference --------------------------------------------------------------------
    def synthesize(self, phonemes: str, voice_id: str, speed: float = 1.0) -> SynthResult:
        if not 0.5 <= speed <= 2.0:
            raise ValueError(f"speed {speed} outside 0.5..2.0")
        ids, dropped = self.tokenize(phonemes)
        if not ids:
            raise ValueError(f"no known phonemes in {phonemes!r}")
        if len(ids) > MAX_TOKENS:
            raise ValueError(f"{len(ids)} phoneme tokens > {MAX_TOKENS}; split the text")
        pack, _ = self.voice(voice_id)
        row = self.style_row(len(ids))
        feeds = {
            "input_ids": np.array([[PAD_ID, *ids, PAD_ID]], dtype=np.int64),
            "style": pack[row].reshape(1, STYLE_DIM),
            "speed": np.array([speed], dtype=np.float32),
        }
        t0 = time.perf_counter()
        res = self.sess.run(self._outputs, feeds)
        dt = time.perf_counter() - t0
        audio = np.asarray(res[0], dtype=np.float32).reshape(-1)
        if not np.isfinite(audio).all():
            raise RuntimeError("model produced non-finite samples")
        durations = None
        if len(res) > 1:
            durations = [int(round(float(v))) for v in np.asarray(res[1]).reshape(-1)]
            if sum(durations) * FRAME_SAMPLES != len(audio) or len(durations) != len(ids) + 2:
                durations = None  # unexpected; never guess timings
        return SynthResult(audio=audio, n_tokens=len(ids), style_row=row, seconds=dt,
                           dropped=dropped, durations=durations)

    def fingerprint(self) -> dict:
        """Everything about the runtime that can change the samples."""
        return {
            "engine": self.engine,
            "engineSha256": self.engine_sha256,
            "sourceSha256": self.source_sha256,
            "onnxruntime": ort.__version__,
            "threads": self.threads,
        }
