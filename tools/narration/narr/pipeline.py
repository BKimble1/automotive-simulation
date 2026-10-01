"""Cue rendering (with the per-cue cache), segment assembly, encoding and verification.

Shared by audition.py and build_narration.py so an audition clip is produced
exactly the way a film segment is.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import audio as A
from . import paths
from .g2p import BritishG2P, G2POutput, PronunciationDictionary, fingerprint as g2p_fingerprint
from .model import FRAME_SAMPLES, MAX_TOKENS, Kokoro

CACHE_VERSION = 2
DEFAULT_PAUSE_AFTER = 0.35
DEFAULT_TAIL = 0.6
DEFAULT_LEAD_IN = 0.0
CHUNK_PAUSE_SENTENCE = 0.30   # only used when one cue is too long for one model call
CHUNK_PAUSE_CLAUSE = 0.15


NON_PHONES = set(" ˈˌː") | set(";:,.!?—…\"“”()")


def count_phones(ps: str) -> int:
    """Number of phones in a Kokoro phoneme string (A, I, Q, W, Y, ʤ, ʧ count as one)."""
    return sum(1 for c in ps if c not in NON_PHONES)


def spoken_words(audio_text: str) -> int:
    """Words actually spoken: the audio text after respellings, pinned words as written."""
    return A.count_words(audio_text.replace("[", " ").replace("]", " "))


def _json_hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def split_phonemes(ps: str, limit: int = MAX_TOKENS) -> list[str]:
    """Split a phoneme string into pieces of at most `limit` symbols, preferring
    sentence ends, then clause punctuation, then spaces."""
    ps = ps.strip()
    if len(ps) <= limit:
        return [ps]
    for pattern in (r"(?<=[.!?…])\s+", r"(?<=[,;:—])\s+", r"\s+"):
        parts = [p for p in re.split(pattern, ps) if p]
        if len(parts) < 2:
            continue
        out, cur = [], ""
        for p in parts:
            cand = f"{cur} {p}".strip()
            if len(cand) <= limit:
                cur = cand
            else:
                if cur:
                    out.append(cur)
                cur = p
        if cur:
            out.append(cur)
        if all(len(p) <= limit for p in out):
            return out
    raise ValueError("cannot split phonemes under the model limit")


@dataclass
class CueAudio:
    text: str
    g2p: G2POutput
    audio: np.ndarray          # trimmed to fixed lead/tail margins, faded, not yet gain-adjusted
    raw_seconds: float         # model output length before trimming
    raw_lead_s: float          # model's own leading silence (first chunk)
    raw_tail_s: float          # model's own trailing silence (last chunk)
    pauses: list               # one entry per in-sentence punctuation mark (see pause_analysis)
    hesitations: list          # word gaps >= 150 ms with no punctuation [[t, dur], ...]
    raw_peak_dbfs: float
    raw_clipped: int
    tokens: int
    chunks: int
    synth_seconds: float       # inference wall time (measured when first synthesised)
    cached: bool
    cache_keys: list[str] = field(default_factory=list)


class Narrator:
    def __init__(self, engine: str = "float-conv", threads: int = 4,
                 dictionary: Path = paths.PRONUNCIATIONS):
        self.model = Kokoro(threads=threads, engine=engine)
        self.dictionary = PronunciationDictionary(dictionary)
        self.g2p = BritishG2P(self.dictionary)
        self.g2p_info = g2p_fingerprint()
        self.cache_dir = paths.CUE_CACHE / self.model.engine_sha256[:12]

    def fingerprint(self) -> dict:
        return {**self.model.fingerprint(), "g2p": self.g2p_info}

    # ------------------------------------------------------------------------------
    def _cache_key(self, text: str, g2p: G2POutput, chunk: str, index: int,
                   voice: str, voice_sha: str, speed: float) -> str:
        return _json_hash({
            "v": CACHE_VERSION,
            "text": text,                      # caption text of the cue
            "dictionary": g2p.used_entries,    # dictionary entries applied to it
            "phonemes": chunk,                 # what the model actually reads
            "chunk": index,
            "voice": voice, "voiceSha256": voice_sha,
            "speed": round(float(speed), 4),
            "model": self.model.fingerprint(),  # engine graph sha, source sha, ORT version, threads
        })

    def _synth_cached(self, key: str, chunk: str, voice: str, speed: float):
        """Return (raw audio, inference seconds, cached?, tokens, durations or None)."""
        wav = self.cache_dir / key[:2] / f"{key}.wav"
        meta = wav.with_suffix(".json")
        if wav.exists() and meta.exists():
            info = json.loads(meta.read_text())
            return (A.read_wav(wav), float(info["synthSeconds"]), True, int(info["tokens"]),
                    info.get("durations"))
        r = self.model.synthesize(chunk, voice, speed)
        A.write_wav(wav, r.audio, subtype="FLOAT")
        meta.write_text(json.dumps({
            "phonemes": chunk, "voice": voice, "speed": speed, "tokens": r.n_tokens,
            "styleRow": r.style_row, "synthSeconds": round(r.seconds, 4),
            "samples": int(len(r.audio)), "durations": r.durations,
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }, ensure_ascii=False))
        return r.audio, r.seconds, False, r.n_tokens, r.durations

    def render(self, text: str, voice: str, speed: float) -> CueAudio:
        g2p = self.g2p.convert(text)
        if not g2p.phonemes.strip():
            raise ValueError(f"no phonemes for cue text {text!r}")
        _, voice_sha = self.model.voice(voice)
        chunks = split_phonemes(g2p.phonemes)
        pieces, keys = [], []
        synth_s, all_cached, tokens = 0.0, True, 0
        raw_len, raw_lead, raw_tail, raw_peak, raw_clip = 0, 0.0, 0.0, 0.0, 0
        pauses, hesitations = [], []
        out_pos = 0  # position in the trimmed cue audio
        for i, chunk in enumerate(chunks):
            key = self._cache_key(text, g2p, chunk, i, voice, voice_sha, speed)
            keys.append(key)
            raw, secs, cached, ntok, durations = self._synth_cached(key, chunk, voice, speed)
            synth_s += secs
            all_cached &= cached
            tokens += ntok
            tr = A.trim(raw)
            if i == 0:
                raw_lead = tr.raw_lead_s
            raw_tail = tr.raw_tail_s
            raw_peak = max(raw_peak, float(np.max(np.abs(raw))))
            raw_clip += int(np.sum(np.abs(raw) >= 0.999))
            # raw-clip sample r -> trimmed-cue sample r - (onset - lead) (+ earlier chunks)
            shift = out_pos - (tr.onset - int(round(A.TRIM_LEAD_S * A.SR)))
            pa = pause_analysis(chunk, self.model.vocab, durations, raw, tr)
            for p in pa["pauses"]:
                p["t"] = round((p.pop("_start") + shift) / A.SR, 3)
            for h in pa["hesitations"]:
                h[0] = round((h[0] + shift) / A.SR, 3)
            pauses += pa["pauses"]
            hesitations += pa["hesitations"]
            raw_len += len(raw)
            pieces.append(tr.audio)
            out_pos += len(tr.audio)
            if i < len(chunks) - 1:
                gap = CHUNK_PAUSE_SENTENCE if re.search(r"[.!?…]$", chunk) else CHUNK_PAUSE_CLAUSE
                pieces.append(A.silence(gap))
                out_pos += len(pieces[-1])
        audio = np.concatenate(pieces).astype(np.float32)
        return CueAudio(text, g2p, audio, raw_len / A.SR, raw_lead, raw_tail, pauses, hesitations,
                        round(20 * np.log10(raw_peak + 1e-10), 2), raw_clip, tokens, len(chunks),
                        synth_s, all_cached, keys)


PAUSE_MARKS = set(",;:—….!?")
HESITATION_MIN_FRAMES = 6   # 150 ms


def pause_analysis(chunk: str, vocab: dict, durations: list[int] | None, raw: np.ndarray, tr) -> dict:
    """Pause behaviour of one model call, from the duration predictor.

    For each punctuation mark before the final one: the time the model gives the
    mark (plus a following space), and how far the signal drops during it relative
    to the speech level ("depth": about -60 dB is clean silence, above about -35 dB
    means breath or a noise bed fills the pause). Word gaps of 150 ms or more with no
    punctuation are listed as hesitations. Without durations (unexpected graph),
    returns empty lists.
    """
    if not durations:
        return {"pauses": [], "hesitations": []}
    known = [c for c in chunk if c in vocab]
    frames = durations[1:-1]
    if len(frames) != len(known):
        return {"pauses": [], "hesitations": []}
    starts = np.cumsum([durations[0]] + frames[:-1]) * FRAME_SAMPLES
    db = A.frame_db(raw)
    body = db[tr.onset // A.FRAME: max(tr.onset // A.FRAME + 1, tr.offset // A.FRAME)]
    speech_level = float(np.median(body[body > body.max() - 40])) if body.size else 0.0
    last_word = max((i for i, c in enumerate(known) if c not in PAUSE_MARKS and c != " "), default=-1)
    pauses, hesitations = [], []
    for i, c in enumerate(known):
        if i > last_word:
            break
        n = frames[i]
        if c in PAUSE_MARKS:
            if i + 1 < len(known) and known[i + 1] == " ":
                n += frames[i + 1]
            a = int(starts[i]) // A.FRAME
            b = max(a + 1, (int(starts[i]) + n * FRAME_SAMPLES) // A.FRAME)
            seg = db[a:b]
            if seg.size >= 5:
                p = 10 ** (seg / 10)
                depth = float(10 * np.log10(np.convolve(p, np.ones(5) / 5, mode="valid").min() + 1e-20))
            else:
                depth = float(seg.min()) if seg.size else 0.0
            pauses.append({"mark": c, "pauseS": round(n * FRAME_SAMPLES / A.SR, 3),
                           "depthDb": round(depth - speech_level, 1), "_start": int(starts[i])})
        elif c == " " and n >= HESITATION_MIN_FRAMES and i > 0 and known[i - 1] not in PAUSE_MARKS:
            hesitations.append([int(starts[i]), round(n * FRAME_SAMPLES / A.SR, 3)])
    return {"pauses": pauses, "hesitations": hesitations}


# ----------------------------------------------------------------------------------
# Segments
# ----------------------------------------------------------------------------------
@dataclass
class SegmentAudio:
    pcm: np.ndarray                 # final (gain applied) PCM that gets encoded
    cue_samples: list[tuple[int, int]]
    cues: list[CueAudio]
    loudness: dict


def assemble(cues: list[CueAudio], pauses_after: list[float], lead_in: float, tail: float) -> SegmentAudio:
    """leadIn + cue1 + pause1 + cue2 + ... + cueN + tail (the last cue's pauseAfter is
    replaced by `tail`), then one static gain to TARGET_LUFS (true peak capped)."""
    parts = [A.silence(lead_in)]
    pos = len(parts[0])
    spans = []
    for i, cue in enumerate(cues):
        spans.append((pos, pos + len(cue.audio)))
        parts.append(cue.audio)
        pos += len(cue.audio)
        gap = A.silence(tail if i == len(cues) - 1 else pauses_after[i])
        parts.append(gap)
        pos += len(gap)
    pcm = np.concatenate(parts).astype(np.float32)
    pcm, info = A.normalise(pcm)
    lufs, tp = A.loudness(pcm)
    info.update(outputLufs=round(lufs, 2), outputTruePeakDb=round(tp, 2))
    return SegmentAudio(pcm, spans, cues, info)


def encode_and_verify(pcm: np.ndarray, out: Path, bitrate_kbps: int = 64) -> dict:
    """Encode, decode the encoded file back, and check length and alignment.

    Returns the decoded duration and the lag (in samples) between the source PCM
    and the decoded audio. With the LAME/Xing gapless header honoured the lag is
    0 and the lengths match exactly; any non-zero lag is returned so cue times
    can be shifted by it.
    """
    A.encode_mp3(pcm, out, bitrate_kbps)
    dec = A.decode(out)
    lag = A.best_lag(pcm, dec)
    data = out.read_bytes()
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "decodedSamples": int(len(dec)),
        "sourceSamples": int(len(pcm)),
        "durationMs": int(round(len(dec) * 1000 / A.SR)),
        "lagSamples": int(lag),
        "lengthMatches": bool(len(dec) == len(pcm)),
        "gapless": A.lame_gapless_info(out),
        "decodedPeakDbfs": round(float(20 * np.log10(np.max(np.abs(dec)) + 1e-10)), 2),
        "_decoded": dec,
    }
