"""Audio utilities: trimming, joining, loudness, MP3 encode/decode and signal QA.

Everything here is deterministic (no dither, no random numbers). ffmpeg comes
from the imageio-ffmpeg wheel (a static build with libmp3lame), so no system
packages are needed.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 24_000
FRAME = SR // 100            # 10 ms analysis frames

# Trimming: a cue keeps exactly this much audio before its first and after its
# last frame above the trim threshold (zero-padded if the model gave less).
TRIM_LEAD_S = 0.040
TRIM_TAIL_S = 0.080
TRIM_REL_DB = -50.0          # threshold relative to the cue's loudest 10 ms frame...
TRIM_ABS_DB = -65.0          # ...but never below this absolute level
FADE_S = 0.005               # raised-cosine fade at every cut

# Loudness: each finished segment gets ONE static gain (no compression or limiting).
TARGET_LUFS = -18.0
TRUE_PEAK_CEILING = -1.5     # dBTP; the gain is lowered if the peak would exceed this

# QA
SILENCE_DB = -50.0           # a 10 ms frame below this (dBFS, after gain) counts as silence
PAUSE_MIN_S = 0.15           # silences shorter than this are ordinary closures, not pauses


def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def ffmpeg_version() -> str:
    out = subprocess.run([ffmpeg_exe(), "-version"], capture_output=True, text=True).stdout
    return out.splitlines()[0] if out else "unknown"


# ---------------------------------------------------------------------------------
# Frames, trimming, joining
# ---------------------------------------------------------------------------------
def frame_db(x: np.ndarray, frame: int = FRAME) -> np.ndarray:
    n = len(x) // frame
    if n == 0:
        return np.full(1, -200.0)
    fr = x[: n * frame].astype(np.float64).reshape(n, frame)
    return 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-10)


def fade(x: np.ndarray, head: bool = True, tail: bool = True, seconds: float = FADE_S) -> np.ndarray:
    n = min(int(seconds * SR), len(x) // 2)
    if n <= 0:
        return x
    y = x.copy()
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(np.float32)
    if head:
        y[:n] *= ramp
    if tail:
        y[-n:] *= ramp[::-1]
    return y


@dataclass
class Trim:
    audio: np.ndarray
    onset: int        # first active sample in the raw clip
    offset: int       # end of the last active frame in the raw clip
    raw_lead_s: float
    raw_tail_s: float


def trim(x: np.ndarray, lead_s: float = TRIM_LEAD_S, tail_s: float = TRIM_TAIL_S) -> Trim:
    """Cut the model's leading/trailing silence down to fixed lead/tail margins."""
    db = frame_db(x)
    thr = max(TRIM_ABS_DB, float(db.max()) + TRIM_REL_DB)
    active = np.flatnonzero(db > thr)
    if active.size == 0:
        raise ValueError("clip is silent")
    onset, offset = int(active[0]) * FRAME, min(len(x), (int(active[-1]) + 1) * FRAME)
    lead, tail = int(round(lead_s * SR)), int(round(tail_s * SR))
    start, end = onset - lead, offset + tail
    y = x[max(0, start): min(len(x), end)]
    y = np.concatenate([np.zeros(max(0, -start), np.float32), y,
                        np.zeros(max(0, end - len(x)), np.float32)]).astype(np.float32)
    return Trim(fade(y), onset, offset, onset / SR, (len(x) - offset) / SR)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(round(seconds * SR)), dtype=np.float32)


# ---------------------------------------------------------------------------------
# ffmpeg helpers
# ---------------------------------------------------------------------------------
def _run(args: list[str], data: bytes | None = None) -> subprocess.CompletedProcess:
    # -nostdin only when nothing is piped in (stdin carries the PCM otherwise)
    extra = ["-nostdin"] if data is None else []
    p = subprocess.run([ffmpeg_exe(), "-hide_banner", "-nostats", *extra, *args],
                       input=data, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(args)}\n{p.stderr.decode(errors='replace')[-2000:]}")
    return p


def loudness(x: np.ndarray) -> tuple[float, float]:
    """(integrated loudness LUFS, true peak dBTP) per EBU R128 / ITU-R BS.1770 via ffmpeg."""
    p = _run(["-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
              "-af", "ebur128=peak=true", "-f", "null", "-"], x.astype("<f4").tobytes())
    err = p.stderr.decode(errors="replace")
    summary = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+|-inf)\s+LUFS", summary)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf)\s+dBFS", summary)
    if not i or not tp:
        raise RuntimeError("could not parse ebur128 output")
    return float(i.group(1)), float(tp.group(1))


def normalise(x: np.ndarray) -> tuple[np.ndarray, dict]:
    lufs, tp = loudness(x)
    gain_db = TARGET_LUFS - lufs
    if tp + gain_db > TRUE_PEAK_CEILING:
        gain_db = TRUE_PEAK_CEILING - tp
    y = (x * np.float32(10 ** (gain_db / 20))).astype(np.float32)
    return y, {"inputLufs": round(lufs, 2), "inputTruePeakDb": round(tp, 2), "gainDb": round(gain_db, 2)}


def write_wav(path: Path, x: np.ndarray, subtype: str = "PCM_16") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part.wav")
    sf.write(str(tmp), np.clip(x, -1.0, 1.0) if subtype.startswith("PCM") else x, SR,
             subtype=subtype, format="WAV")
    tmp.replace(path)


def read_wav(path: Path) -> np.ndarray:
    x, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if sr != SR:
        raise ValueError(f"{path}: sample rate {sr} != {SR}")
    return x


def encode_mp3(x: np.ndarray, out: Path, bitrate_kbps: int = 64) -> None:
    """Mono CBR MP3 at 24 kHz with a LAME/Xing header (gapless info), no ID3 tags."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part.mp3")
    _run(["-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
          "-c:a", "libmp3lame", "-b:a", f"{bitrate_kbps}k", "-ar", str(SR), "-ac", "1",
          "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1",
          "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "mp3", str(tmp)],
         np.clip(x, -1.0, 1.0).astype("<f4").tobytes())
    tmp.replace(out)


def decode(path: Path) -> np.ndarray:
    """Decode with ffmpeg (which applies the LAME header's encoder delay and padding)."""
    p = _run(["-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"])
    return np.frombuffer(p.stdout, dtype="<f4").copy()


def lame_gapless_info(path: Path) -> dict:
    """Parse the Xing/Info tag + LAME extension of the first frame (gapless metadata).

    Returns frame count, encoder delay and end padding in samples. A decoder that
    honours this header (ffmpeg, Chromium, Firefox) skips delay + 529 decoder-delay
    samples at the start and the padding at the end, giving back exactly the
    encoded PCM length; decode() checks that for every file.
    """
    data = Path(path).read_bytes()[:2048]
    pos = next((p for p in (data.find(b"Info"), data.find(b"Xing")) if p >= 0), -1)
    if pos < 0 or pos > 64:
        return {"xingTag": False}
    flags = int.from_bytes(data[pos + 4: pos + 8], "big")
    off = pos + 8
    frames = nbytes = None
    if flags & 1:
        frames = int.from_bytes(data[off: off + 4], "big")
        off += 4
    if flags & 2:
        nbytes = int.from_bytes(data[off: off + 4], "big")
        off += 4
    off += 100 if flags & 4 else 0
    off += 4 if flags & 8 else 0
    ext = data[off: off + 36]
    info = {"xingTag": True, "tag": data[pos: pos + 4].decode(), "frames": frames, "bytes": nbytes}
    if len(ext) == 36 and ext[:4] in (b"LAME", b"Lavf", b"Lavc", b"L3.9"):
        b = ext[21:24]
        info.update(encoder=ext[:9].decode("ascii", "replace").rstrip("\x00"),
                    encoderDelaySamples=(b[0] << 4) | (b[1] >> 4),
                    paddingSamples=((b[1] & 0x0F) << 8) | b[2])
    return info


def best_lag(ref: np.ndarray, test: np.ndarray, max_lag: int = 4000) -> int:
    """Lag (samples) that best aligns test to ref; positive = test is late."""
    n = min(len(ref), len(test), SR * 20)
    a, b = ref[:n].astype(np.float64), test[:n].astype(np.float64)
    size = 1 << int(np.ceil(np.log2(2 * n)))
    xc = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    vals = np.concatenate([xc[: max_lag + 1], xc[-max_lag:]])
    return int(lags[int(np.argmax(vals))])


# ---------------------------------------------------------------------------------
# Signal QA
# ---------------------------------------------------------------------------------
def silences(x: np.ndarray, threshold_db: float = SILENCE_DB) -> dict:
    db = frame_db(x)
    active = np.flatnonzero(db > threshold_db)
    total = len(x) / SR
    if active.size == 0:
        return {"leadingSilenceS": total, "trailingSilenceS": total, "longestInternalSilenceS": 0.0,
                "pauses": [], "speechSpanS": 0.0}
    first, last = int(active[0]), int(active[-1])
    runs, start = [], None
    for i in range(first, last + 1):
        if db[i] <= threshold_db and start is None:
            start = i
        elif db[i] > threshold_db and start is not None:
            runs.append((start, i))
            start = None
    pauses = [(a * FRAME / SR, (b - a) * FRAME / SR) for a, b in runs if (b - a) * FRAME / SR >= PAUSE_MIN_S]
    longest = max(((b - a) * FRAME / SR for a, b in runs), default=0.0)
    return {
        "leadingSilenceS": round(first * FRAME / SR, 3),
        "trailingSilenceS": round(total - (last + 1) * FRAME / SR, 3),
        "longestInternalSilenceS": round(longest, 3),
        "pauses": [[round(t, 2), round(d, 2)] for t, d in pauses],
        "speechSpanS": round((last + 1 - first) * FRAME / SR, 3),
    }


def f0_track(x: np.ndarray, fmin: float = 60.0, fmax: float = 400.0) -> np.ndarray:
    """Per-10 ms F0 in Hz (0 = unvoiced) from a normalised-autocorrelation (YIN-style) search."""
    win = int(0.040 * SR)
    hop = FRAME
    n = 1 + max(0, (len(x) - win) // hop)
    if len(x) < win:
        return np.zeros(0)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    fr = x[idx].astype(np.float64)
    fr -= fr.mean(axis=1, keepdims=True)
    size = 1 << int(np.ceil(np.log2(2 * win)))
    spec = np.fft.rfft(fr, size, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, size, axis=1)[:, :win]
    energy = np.cumsum(fr[:, ::-1] ** 2, axis=1)[:, ::-1]  # sum_{j>=tau} x_j^2
    e0 = ac[:, :1]
    d = e0 + energy - 2 * ac                                # YIN difference function (approx.)
    tau = np.arange(win)
    cmnd = np.ones_like(d)
    cums = np.cumsum(d[:, 1:], axis=1)
    cmnd[:, 1:] = d[:, 1:] * tau[None, 1:] / np.maximum(cums, 1e-12)
    lo, hi = int(SR / fmax), int(SR / fmin)
    seg = cmnd[:, lo:hi]
    best = seg.argmin(axis=1) + lo
    val = seg.min(axis=1)
    rms = np.sqrt((fr ** 2).mean(axis=1))
    voiced = (val < 0.15) & (20 * np.log10(rms + 1e-10) > -45)
    # parabolic interpolation around the minimum
    b = np.clip(best, 1, win - 2)
    y0, y1, y2 = cmnd[np.arange(n), b - 1], cmnd[np.arange(n), b], cmnd[np.arange(n), b + 1]
    denom = y0 - 2 * y1 + y2
    safe = np.where(np.abs(denom) > 1e-12, denom, 1.0)
    shift = np.where(np.abs(denom) > 1e-12, 0.5 * (y0 - y2) / safe, 0.0)
    f0 = SR / (b + np.clip(shift, -1, 1))
    return np.where(voiced, f0, 0.0)


def pitch_stats(x: np.ndarray) -> dict:
    f0 = f0_track(x)
    v = f0[f0 > 0]
    if v.size < 10:
        return {"f0MedianHz": None, "f0RangeSemitones": None, "pitchJumpsPerMin": None, "voicedShare": 0.0}
    both = (f0[1:] > 0) & (f0[:-1] > 0)
    st = 12 * np.log2(f0[1:][both] / f0[:-1][both])
    jumps = int(np.sum(np.abs(st) > 7.0))  # >7 semitones between adjacent voiced 10 ms frames
    minutes = len(x) / SR / 60
    return {
        "f0MedianHz": round(float(np.median(v)), 1),
        "f0RangeSemitones": round(float(12 * np.log2(np.percentile(v, 95) / np.percentile(v, 5))), 1),
        "pitchJumpsPerMin": round(jumps / minutes, 1) if minutes else None,
        "voicedShare": round(float(v.size / max(1, f0.size)), 3),
    }


def spikes(x: np.ndarray) -> int:
    """Count isolated sample spikes/clicks: 2nd difference far above the local level."""
    if len(x) < 1000:
        return 0
    d2 = np.abs(np.diff(x.astype(np.float64), 2))
    k = int(0.005 * SR)
    local = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(k) / k, mode="same"))[1:-1]
    return int(np.sum((d2 > 0.05) & (d2 > 12 * (local + 1e-4))))


def hf_share_db(x: np.ndarray, cutoff: float = 8000.0) -> float | None:
    """Energy above `cutoff` relative to total, over frames within 40 dB of the loudest."""
    n = 1024
    if len(x) < n:
        return None
    hop = FRAME
    idx = np.arange(n)[None, :] + hop * np.arange(1 + (len(x) - n) // hop)[:, None]
    P = np.abs(np.fft.rfft(x[idx] * np.hanning(n), axis=1)) ** 2
    e = P.sum(axis=1)
    act = e > e.max() * 1e-4
    freqs = np.fft.rfftfreq(n, 1 / SR)
    return round(float(10 * np.log10(P[act][:, freqs >= cutoff].sum() / P[act].sum())), 1)


def bursts(x: np.ndarray) -> dict:
    """Level consistency: the loudest 50 ms window relative to the median speech window.

    Even narration sits around 5-8 dB. A large value right at the start of speech
    (onsetBurstDb) is the "pop" some voices put on sentence onsets.
    """
    w = int(0.05 * SR)
    n = len(x) // w
    if n < 4:
        return {"burstDb": None, "burstAtS": None, "onsetBurstDb": None}
    r = 20 * np.log10(np.sqrt((x[: n * w].astype(np.float64).reshape(n, w) ** 2).mean(axis=1)) + 1e-10)
    act = np.flatnonzero(r > r.max() - 30)
    med = float(np.median(r[act]))
    first = int(act[0])
    onset = r[first: first + 10]  # first 0.5 s of speech
    return {"burstDb": round(float(r.max()) - med, 1), "burstAtS": round(int(np.argmax(r)) * 0.05, 2),
            "onsetBurstDb": round(float(onset.max()) - med, 1)}


def analyze(x: np.ndarray, words: int | None = None) -> dict:
    dur = len(x) / SR
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    s = silences(x)
    out = {
        "durationS": round(dur, 3),
        "peakDbfs": round(20 * np.log10(peak + 1e-10), 2),
        "clippedSamples": int(np.sum(np.abs(x) >= 0.999)),
        "dcOffset": round(float(np.mean(x)), 5) if len(x) else 0.0,
        **s,
        **pitch_stats(x),
        **bursts(x),
        "spikes": spikes(x),
        "hfShareDb": hf_share_db(x),
    }
    if words:
        out["words"] = words
        out["wpm"] = round(words / (dur / 60), 1) if dur else None
        span = s["speechSpanS"]
        out["speechWpm"] = round(words / (span / 60), 1) if span else None
    return out


def count_words(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*", text))
