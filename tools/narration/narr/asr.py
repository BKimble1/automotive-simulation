"""Optional intelligibility check: transcribe audio with Moonshine-tiny and score the words.

Model: Moonshine tiny (English, MIT) quantized ONNX, as bundled in the npm package
@moonshine-ai/moonshine-js@0.1.29; tokenizer.json from the PyPI wheel
useful-moonshine-onnx==20251121 (MIT). Both are fetched by ``fetch_model.py --asr``
and hash-checked against model-lock.json. The greedy decoding loop follows
useful-moonshine-onnx's ``MoonshineOnnxModel.generate``.

What the word error rate means here: it is a proxy for intelligibility, measured
by a small (27M-parameter) recogniser that has its own errors, especially on
technical words and letter names ("CMOS", "reticle"). It is useful to compare
voices on identical text and to flag a cue that transcribes very differently
from its script. It is not proof that a word is pronounced correctly.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from . import audio as A
from . import paths

ASR_SR = 16_000
PAD_S = 0.25   # silence added around each clip: without it Moonshine sometimes invents words at the start
NUM_LAYERS, KV_HEADS, HEAD_DIM = 6, 8, 36   # moonshine tiny
START_ID, EOS_ID = 1, 2


def _resample_to_16k(x: np.ndarray) -> np.ndarray:
    p = A._run(["-f", "f32le", "-ar", str(A.SR), "-ac", "1", "-i", "pipe:0",
                "-af", f"aresample={ASR_SR}:resampler=soxr:precision=28", "-f", "f32le",
                "-ar", str(ASR_SR), "-ac", "1", "pipe:1"], x.astype("<f4").tobytes())
    return np.frombuffer(p.stdout, dtype="<f4").copy()


class MoonshineASR:
    def __init__(self, lock: dict, threads: int = 4):
        import onnxruntime as ort

        from .model import sha256_file

        files = {f["path"]: paths.HERE / f["dest"] for f in lock["npm"]["files"] + lock["pypi"]["files"]}
        for f in lock["npm"]["files"] + lock["pypi"]["files"]:
            if f["path"].endswith((".onnx", ".json")) and sha256_file(paths.HERE / f["dest"]) != f["sha256"]:
                raise SystemExit(f"{f['dest']} does not match model-lock.json")
        enc = next(p for k, p in files.items() if k.endswith("encoder_model.onnx"))
        dec = next(p for k, p in files.items() if k.endswith("decoder_model_merged.onnx"))
        tok = next(p for k, p in files.items() if k.endswith("tokenizer.json"))
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.log_severity_level = 3
        self.encoder = ort.InferenceSession(str(enc), so, providers=["CPUExecutionProvider"])
        self.decoder = ort.InferenceSession(str(dec), so, providers=["CPUExecutionProvider"])
        self.decoder_inputs = {i.name for i in self.decoder.get_inputs()}
        t = json.loads(Path(tok).read_text(encoding="utf-8"))
        self.id_to_piece = {v: k for k, v in t["model"]["vocab"].items()}
        for a in t.get("added_tokens", []):
            self.id_to_piece[a["id"]] = a["content"]
        self.special = {a["id"] for a in t.get("added_tokens", []) if a.get("special")}
        self.lock = lock

    def describe(self) -> str:
        return (f"Moonshine tiny (MIT) from `{self.lock['npm']['package']}@{self.lock['npm']['version']}` "
                f"+ tokenizer from `{self.lock['pypi']['package']}=={self.lock['pypi']['version']}`; "
                "word error rate against the spoken script, a rough intelligibility proxy")

    def _decode_tokens(self, ids: list[int]) -> str:
        out = bytearray()
        for i in ids:
            if i in self.special:
                continue
            piece = self.id_to_piece.get(i, "")
            m = re.fullmatch(r"<0x([0-9A-Fa-f]{2})>", piece)
            if m:
                out.append(int(m.group(1), 16))
            else:
                out += piece.replace("▁", " ").encode("utf-8")
        return out.decode("utf-8", errors="replace").strip()

    def transcribe(self, x24k: np.ndarray) -> str:
        pad = A.silence(PAD_S)
        audio = _resample_to_16k(np.concatenate([pad, x24k.astype(np.float32), pad]))
        seconds = len(audio) / ASR_SR
        if seconds < 0.1:
            return ""
        audio = audio[None, :].astype(np.float32)
        hidden = self.encoder.run(None, {"input_values": audio})[0]
        past = {f"past_key_values.{i}.{a}.{b}": np.zeros((0, KV_HEADS, 1, HEAD_DIM), np.float32)
                for i in range(NUM_LAYERS) for a in ("decoder", "encoder") for b in ("key", "value")}
        tokens = [START_ID]
        ids = [[START_ID]]
        max_len = int(np.ceil(seconds * 6.5)) + 8
        for step in range(max_len):
            feeds = {"input_ids": np.array(ids, dtype=np.int64), "encoder_hidden_states": hidden,
                     "use_cache_branch": np.array([step > 0]), **past}
            if "encoder_attention_mask" in self.decoder_inputs:
                feeds["encoder_attention_mask"] = np.ones((1, hidden.shape[1]), dtype=np.int64)
            logits, *present = self.decoder.run(None, feeds)
            nxt = int(logits[0, -1].argmax())
            tokens.append(nxt)
            if nxt == EOS_ID:
                break
            ids = [[nxt]]
            for k, v in zip(past.keys(), present):
                if step == 0 or "decoder" in k:
                    past[k] = v
        return self._decode_tokens(tokens)

    def check(self, x24k: np.ndarray, caption: str, audio_text: str, entries: list[dict] | None = None) -> dict:
        """Transcribe one cue and compare it with the words that were meant to be heard.

        Two references are tried and the closer one is kept: the caption, and the
        audio text (after respellings such as GND -> "ground"). Both are normalised
        like the hypothesis (lower case, digits to words, British -metre spellings to
        -meter, punctuation and "and" dropped). A dictionary entry may list the
        transcriptions it accepts (``"asr": ["see moss", ...]``); those are mapped
        back to the entry's key before scoring.
        """
        hyp = self.transcribe(x24k)
        hyp_all = apply_alternatives(normalise_words(hyp), entries or [])
        best = None
        for ref_text in (caption, audio_text.replace("[", "").replace("]", "")):
            ref_words = normalise_words(ref_text)
            # "left over" vs "leftover", "photo resist" vs "photoresist" are spelling, not hearing
            hyp_words = merge_compounds(hyp_all, set(ref_words))
            ref_words = merge_compounds(ref_words, set(hyp_words))
            errs = edit_distance(ref_words, hyp_words)
            if best is None or errs / max(1, len(ref_words)) < best[0] / max(1, len(best[1])):
                best = (errs, ref_words, hyp_words)
        errs, ref_words, hyp_words = best
        return {"hypothesis": hyp, "reference": " ".join(ref_words), "errors": errs,
                "refWords": len(ref_words), "wer": round(errs / max(1, len(ref_words)), 3),
                "diffs": word_diffs(ref_words, hyp_words)}


_SPELLING = [(r"(\w)metres?\b", lambda m: m.group(0).replace("metre", "meter")),
             (r"\bcolour", lambda m: "color"), (r"\bcentre", lambda m: "center"),
             (r"\baluminium\b", lambda m: "aluminum")]


def normalise_words(text: str) -> list[str]:
    from num2words import num2words

    t = text.lower().replace("’", "'")
    t = re.sub(r"(\d+)\.(\d+)", lambda m: f"{num2words(int(m.group(1)))} point "
               + " ".join(num2words(int(d)) for d in m.group(2)), t)
    t = re.sub(r"\d+", lambda m: num2words(int(m.group(0))), t)
    for pat, fn in _SPELLING:
        t = re.sub(pat, fn, t)
    t = t.replace("'", "")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return [w for w in t.split() if w and w != "and"]  # "and" inside numbers is optional


def apply_alternatives(words: list[str], entries: list[dict]) -> list[str]:
    """Replace accepted transcriptions of dictionary entries by the entry's key."""
    for e in entries:
        key = normalise_words(e["key"])
        for alt in e.get("asr", []):
            seq = normalise_words(alt)
            if not seq or seq == key:
                continue
            i, out = 0, []
            while i < len(words):
                if words[i:i + len(seq)] == seq:
                    out += key
                    i += len(seq)
                else:
                    out.append(words[i])
                    i += 1
            words = out
    return words


def merge_compounds(words: list[str], vocab: set[str]) -> list[str]:
    """Join two adjacent words when the joined form is a word of the other side."""
    out, i = [], 0
    while i < len(words):
        if i + 1 < len(words) and words[i] + words[i + 1] in vocab:
            out.append(words[i] + words[i + 1])
            i += 2
        else:
            out.append(words[i])
            i += 1
    return out


def word_diffs(ref: list[str], hyp: list[str]) -> list[list[str]]:
    """[[expected words, heard words], ...] for every mismatching stretch."""
    import difflib

    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False).get_opcodes():
        if op != "equal":
            out.append([" ".join(ref[i1:i2]) or "∅", " ".join(hyp[j1:j2]) or "∅"])
    return out


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def load_if_available(threads: int = 4) -> MoonshineASR | None:
    if not paths.LOCK.exists():
        return None
    lock = json.loads(paths.LOCK.read_text()).get("asr")
    if not lock:
        return None
    if not all((paths.HERE / f["dest"]).exists() for f in lock["npm"]["files"] + lock["pypi"]["files"]):
        return None
    return MoonshineASR(lock, threads)
