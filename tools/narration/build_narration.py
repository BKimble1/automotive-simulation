#!/usr/bin/env python3
"""Build the bundled narration audio for FAB / ONE's Watch mode from a narration script.

Input (default: src/content/narration.json in the repository):

    { "version": "<string>", "voice": "<voice id>", "speed": <number>,
      "segments": [ { "id": "<segment id>", "leadIn": <s, default 0>,
                      "cues": [ { "id": "<cue id>", "text": "<exact caption text>",
                                  "pauseAfter": <s, default 0.35> } ],
                      "tail": <s, default 0.6> } ] }

Output (public/narration/<version>/):

    <segmentId>.mp3  one mono 24 kHz 64 kbps MP3 per segment
    manifest.json    what the app reads: files, measured durations, cue start/end times
    qa.json          per-cue measurements, G2P details and outlier flags

A segment is: leadIn silence, cue 1, its pauseAfter, cue 2, ..., the last cue, then
`tail` seconds of silence (the last cue's pauseAfter is not used). Every cue's
model output is trimmed to fixed 40 ms / 80 ms margins around the speech, so
pauses are exactly what the script says. Each segment gets one static gain to
-18 LUFS (true peak capped at -1.5 dBTP).

Timing: cue startMs/endMs are sample positions in the assembled PCM (startMs is
the start of the cue's clip, 40 ms before speech; endMs its end, ~80 ms after the
last speech energy). Every MP3 is decoded back with ffmpeg, which honours the
LAME/Xing gapless header (encoder delay + padding); the decoded length must equal
the PCM length and cross-correlation must find zero lag, otherwise cue times are
shifted by the measured lag and the build reports it. durationMs is the decoded
length of the encoded file.

Incremental and deterministic: raw model output is cached per cue under
.cache/cues/, keyed by caption text + dictionary entries used + phonemes + voice
(+ voice file hash) + speed + model/engine hashes + onnxruntime version + threads.
Editing one sentence re-synthesises only that sentence. Same input -> same bytes.

Usage:
    .venv/bin/python build_narration.py [INPUT] [--out DIR] [--no-asr] [--strict]
    .venv/bin/python build_narration.py INPUT --phonemes     # G2P preview only, no audio
    .venv/bin/python build_narration.py --selftest
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import statistics
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from narr import audio as A  # noqa: E402
from narr import paths  # noqa: E402
from narr.pipeline import (  # noqa: E402
    DEFAULT_LEAD_IN, DEFAULT_PAUSE_AFTER, DEFAULT_TAIL, Narrator, assemble, count_phones,
    encode_and_verify, spoken_words,
)

SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
BITRATE_KBPS = 64
THRESHOLDS = {
    "rateDeviation": 0.25,        # |phonemes/s - median| / median, when there are >= 5 cues
    "rateMinPhonemesPerS": 9.0, "rateMaxPhonemesPerS": 17.0,
    "longInternalSilenceS": 0.8,  # silence inside one cue
    "onsetBurstDb": 12.0,         # first 0.5 s of speech this far above the cue's median level
    "pitchJumpsPerMin": 30.0,
    "asrWer": 0.25,
    "minCueS": 0.6,
}
HARD_FLAGS = {"no-phonemes-for-word", "clipping", "decode-mismatch"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def shown(p: Path) -> str:
    """Path relative to the repository when inside it, else absolute (for messages)."""
    try:
        return str(p.resolve().relative_to(paths.REPO))
    except ValueError:
        return str(p)


# ---------------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------------
def load_script(path: Path, voices: set[str]) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"{path} not found (see tools/narration/example-narration.json for the format)")
    errors, warnings = [], []

    def num(obj, key, default, where):
        v = obj.get(key, default)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
            errors.append(f"{where}: {key} must be a number >= 0")
            return default
        return float(v)

    for k in data:
        if k not in ("version", "voice", "speed", "segments") and not k.startswith(("$", "_", "note")):
            warnings.append(f"unknown top-level key {k!r} ignored")
    version = data.get("version")
    if not isinstance(version, str) or not SAFE_ID.match(version):
        errors.append("version must be a string of letters, digits, '.', '_' or '-'")
    voice = data.get("voice")
    if voice not in voices:
        errors.append(f"voice {voice!r} is not extracted; available: {sorted(voices)} "
                      f"(fetch_model.py --voices {voice} adds one)")
    speed = data.get("speed", 1.0)
    if not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2.0:
        errors.append("speed must be a number between 0.5 and 2.0")
    segs = data.get("segments")
    if not isinstance(segs, list) or not segs:
        errors.append("segments must be a non-empty list")
        segs = []
    seen = set()
    out_segs = []
    for si, seg in enumerate(segs):
        where = f"segments[{si}]"
        sid = seg.get("id") if isinstance(seg, dict) else None
        if not isinstance(sid, str) or not SAFE_ID.match(sid):
            errors.append(f"{where}: id must be a file-name-safe string")
            continue
        if sid in seen:
            errors.append(f"{where}: duplicate segment id {sid!r}")
        seen.add(sid)
        cues = seg.get("cues")
        if not isinstance(cues, list) or not cues:
            errors.append(f"{where} ({sid}): cues must be a non-empty list")
            continue
        cue_ids, out_cues = set(), []
        for ci, cue in enumerate(cues):
            cw = f"{sid}.cues[{ci}]"
            cid = cue.get("id") if isinstance(cue, dict) else None
            text = cue.get("text") if isinstance(cue, dict) else None
            if not isinstance(cid, str) or not cid:
                errors.append(f"{cw}: id must be a non-empty string")
                continue
            if cid in cue_ids:
                errors.append(f"{cw}: duplicate cue id {cid!r} in segment {sid!r}")
            cue_ids.add(cid)
            if not isinstance(text, str) or not text.strip():
                errors.append(f"{cw} ({cid}): text must be a non-empty string")
                continue
            out_cues.append({"id": cid, "text": text,
                             "pauseAfter": num(cue, "pauseAfter", DEFAULT_PAUSE_AFTER, cw)})
        out_segs.append({"id": sid, "leadIn": num(seg, "leadIn", DEFAULT_LEAD_IN, where),
                         "tail": num(seg, "tail", DEFAULT_TAIL, where), "cues": out_cues})
    for w in warnings:
        log(f"warning: {w}")
    if errors:
        raise SystemExit(f"{path}: invalid narration script:\n  " + "\n  ".join(errors))
    return {"version": version, "voice": voice, "speed": float(speed), "segments": out_segs}


# ---------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------
def licenses(lock: dict, g2p: dict) -> list[dict]:
    return [
        {"component": "Kokoro-82M v1.0 model weights and voice styles (generated this audio)",
         "author": "hexgrad", "license": "Apache-2.0",
         "source": "https://huggingface.co/hexgrad/Kokoro-82M (ONNX export bundled in the npm package "
                   f"{lock['package']}@{lock['version']})",
         "text": "tools/narration/LICENSES/Kokoro-82M-Apache-2.0.txt"},
        {"component": f"{lock['package']} {lock['version']} (npm package that ships the ONNX export)",
         "author": "Dane Madsen", "license": "MIT",
         "text": "tools/narration/LICENSES/expo-kokoro-MIT.txt"},
        {"component": f"misaki {g2p['misaki']} (English G2P rules and British lexicon; build time only)",
         "author": "hexgrad", "license": "Apache-2.0",
         "text": "tools/narration/LICENSES/misaki-Apache-2.0.txt"},
        {"component": f"espeak-ng {g2p['espeak-ng']} via espeakng-loader and phonemizer-fork "
                      "(fallback G2P; build time only, not distributed)",
         "license": "GPL-3.0-or-later"},
        {"component": "FFmpeg with LAME (MP3 encoding; build time only, not distributed)",
         "license": "GPL (static build from imageio-ffmpeg); LAME is LGPL-2.0"},
    ]


def cue_flags(q: dict, g2p_warnings: list[str], asr: dict | None, median_rate: float | None) -> list[str]:
    f = []
    if any(w.startswith("no phonemes for") for w in g2p_warnings):
        f.append("no-phonemes-for-word")
    if q["clippedSamples"]:
        f.append("clipping")
    rate = q.get("phonemesPerS")
    if rate is not None and q["durationS"] > 1.5:
        if median_rate and abs(rate - median_rate) / median_rate > THRESHOLDS["rateDeviation"]:
            f.append("rate-outlier")
        elif not THRESHOLDS["rateMinPhonemesPerS"] <= rate <= THRESHOLDS["rateMaxPhonemesPerS"]:
            f.append("rate-outlier")
    if q["longestInternalSilenceS"] > THRESHOLDS["longInternalSilenceS"]:
        f.append("long-internal-silence")
    if q["rawPeakDbfs"] > 0:
        f.append("raw-peak-over-full-scale")
    if (q.get("onsetBurstDb") or 0) > THRESHOLDS["onsetBurstDb"]:
        f.append("onset-burst")
    if (q.get("pitchJumpsPerMin") or 0) > THRESHOLDS["pitchJumpsPerMin"]:
        f.append("pitch-jumps")
    if q["spikes"]:
        f.append("spikes")
    if q["durationS"] < THRESHOLDS["minCueS"]:
        f.append("very-short-cue")
    if asr and asr["wer"] > THRESHOLDS["asrWer"]:
        f.append("asr-mismatch")
    return f


def build(script_path: Path, out_root: Path, engine: str, threads: int, use_asr: bool, strict: bool) -> int:
    t_start = time.perf_counter()
    nar = Narrator(engine=engine, threads=threads)
    lock = nar.model.lock
    script = load_script(script_path, set(lock.get("voices", [])))
    version, voice, speed = script["version"], script["voice"], script["speed"]
    out_dir = out_root / version
    out_dir.mkdir(parents=True, exist_ok=True)
    wav_dir = paths.BUILD_WAV / version
    asr = None
    if use_asr:
        from narr import asr as asr_mod

        asr = asr_mod.load_if_available(threads)
        if asr is None:
            log("ASR check skipped: run fetch_model.py --asr to enable it")

    n_cues = sum(len(s["cues"]) for s in script["segments"])
    log(f"{script_path}: version {version}, voice {voice}, speed {speed:g}, "
        f"{len(script['segments'])} segments, {n_cues} cues; engine {engine}")

    seg_results, qa_segments = [], []
    synth_total = audio_total = 0.0
    hits = 0
    done = 0
    for seg in script["segments"]:
        cues = []
        for cue in seg["cues"]:
            c = nar.render(cue["text"], voice, speed)
            cues.append(c)
            done += 1
            hits += c.cached
            synth_total += c.synth_seconds
            audio_total += c.raw_seconds
            log(f"  [{done}/{n_cues}] {seg['id']}/{cue['id']}: {len(c.audio) / A.SR:5.2f}s "
                f"{'cached' if c.cached else f'synth {c.synth_seconds:.2f}s'}")
        sa = assemble(cues, [c["pauseAfter"] for c in seg["cues"]], seg["leadIn"], seg["tail"])
        A.write_wav(wav_dir / f"{seg['id']}.wav", sa.pcm)
        mp3 = out_dir / f"{seg['id']}.mp3"
        enc = encode_and_verify(sa.pcm, mp3, BITRATE_KBPS)
        dec = enc.pop("_decoded")
        lag = enc["lagSamples"]
        seg_flags = []
        if not enc["lengthMatches"] or lag != 0:
            seg_flags.append("decode-mismatch")
            log(f"  WARNING {seg['id']}: decoded {enc['decodedSamples']} vs {enc['sourceSamples']} samples, "
                f"lag {lag}; cue times shifted by the lag")
        cue_rows = []
        for spec, c, (a, b) in zip(seg["cues"], cues, sa.cue_samples):
            q = A.analyze(sa.pcm[a:b], words=spoken_words(c.g2p.audio_text))
            q["rawPeakDbfs"] = c.raw_peak_dbfs
            q["phonemesPerS"] = (round(count_phones(c.g2p.phonemes) / q["speechSpanS"], 2)
                                 if q["speechSpanS"] else None)
            row = {
                "id": spec["id"], "text": spec["text"],
                "startMs": int(round((a + lag) * 1000 / A.SR)),
                "endMs": int(round((b + lag) * 1000 / A.SR)),
                "audioText": c.g2p.audio_text, "phonemes": c.g2p.phonemes,
                "dictionary": [e["key"] for e in c.g2p.used_entries],
                "espeakWords": [w.text for w in c.g2p.words if w.source == "espeak"],
                "g2pWarnings": c.g2p.warnings,
                "tokens": c.tokens, "chunks": c.chunks,
                "synthS": round(c.synth_seconds, 3), "cached": c.cached,
                "modelLeadS": round(c.raw_lead_s, 3), "modelTailS": round(c.raw_tail_s, 3),
                "pauses": c.pauses, "unpunctuatedGaps": c.hesitations,
                "qa": q,
            }
            if asr is not None:
                row["asr"] = asr.check(sa.pcm[a:b], spec["text"], c.g2p.audio_text, c.g2p.asr_alternatives)
            cue_rows.append(row)
        seg_results.append({"id": seg["id"], "file": mp3.name, "bytes": enc["bytes"], "sha256": enc["sha256"],
                            "durationMs": enc["durationMs"],
                            "cues": [{"id": r["id"], "text": r["text"], "startMs": r["startMs"], "endMs": r["endMs"]}
                                     for r in cue_rows]})
        qa_segments.append({"id": seg["id"], "file": mp3.name, "durationMs": enc["durationMs"],
                            "loudness": sa.loudness,
                            "encoded": {k: v for k, v in enc.items() if k not in ("sha256",)},
                            "decodedPeakDbfs": round(float(20 * np.log10(np.max(np.abs(dec)) + 1e-10)), 2),
                            "flags": seg_flags, "cues": cue_rows})

    # outlier flags need the whole build (median speaking rate)
    rates = [r["qa"]["phonemesPerS"] for s in qa_segments for r in s["cues"] if r["qa"].get("phonemesPerS")]
    median_rate = statistics.median(rates) if len(rates) >= 5 else None
    wpms = [r["qa"]["speechWpm"] for s in qa_segments for r in s["cues"] if r["qa"].get("speechWpm")]
    n_flags = hard = 0
    for s in qa_segments:
        for r in s["cues"]:
            r["flags"] = cue_flags(r["qa"], r["g2pWarnings"], r.get("asr"), median_rate)
            n_flags += len(r["flags"])
            hard += sum(1 for f in r["flags"] if f in HARD_FLAGS)
        n_flags += len(s["flags"])
        hard += sum(1 for f in s["flags"] if f in HARD_FLAGS)

    # stale segment files from an earlier build of this version
    keep = {s["file"] for s in seg_results}
    for old in out_dir.glob("*.mp3"):
        if old.name not in keep:
            old.unlink()
            log(f"removed stale {shown(old)}")

    fp = nar.fingerprint()
    manifest = {
        "version": version,
        "voice": voice,
        "speed": speed,
        "model": {
            "package": lock["package"], "version": lock["version"], "sha256": lock["model"]["sha256"],
            "name": "Kokoro-82M v1.0", "license": "Apache-2.0",
            "engine": fp["engine"], "engineSha256": fp["engineSha256"],
        },
        "generatedAt": None,
        "audio": {
            "codec": "mp3", "sampleRate": A.SR, "channels": 1, "bitrateKbps": BITRATE_KBPS,
            "loudnessLufs": A.TARGET_LUFS, "truePeakCeilingDb": A.TRUE_PEAK_CEILING,
            "fileBase": "segment file names are relative to this manifest",
            "timing": "startMs/endMs are sample positions of each cue clip in the segment "
                      "(clip = speech plus 40 ms before and ~80 ms after); durationMs is the "
                      "decoded length of the MP3. Measured with ffmpeg decoding, which honours "
                      "the LAME gapless header (encoder delay and padding removed).",
        },
        "segments": seg_results,
        "licenses": licenses(lock, fp["g2p"]),
    }
    man_path = out_dir / "manifest.json"
    stamp = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if man_path.exists():  # keep the old timestamp when nothing but the timestamp would change
        try:
            old = json.loads(man_path.read_text())
            if {**old, "generatedAt": None} == manifest:
                stamp = old["generatedAt"]
        except (ValueError, KeyError):
            pass
    manifest["generatedAt"] = stamp
    man_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    qa = {
        "version": version, "generatedAt": stamp, "voice": voice, "speed": speed,
        "fingerprint": fp, "thresholds": THRESHOLDS, "hardFlags": sorted(HARD_FLAGS),
        "summary": {
            "segments": len(seg_results), "cues": n_cues,
            "audioSeconds": round(sum(s["durationMs"] for s in seg_results) / 1000, 2),
            "modelAudioSeconds": round(audio_total, 2),
            "synthSeconds": round(synth_total, 2),
            "rtf": round(synth_total / audio_total, 3) if audio_total else None,
            "cacheHits": hits, "medianPhonemesPerS": median_rate,
            "medianSpeechWpm": statistics.median(wpms) if wpms else None,
            "flags": n_flags, "hardFlags": hard,
            "bytes": sum(s["bytes"] for s in seg_results),
            "asrWer": (round(sum(r["asr"]["errors"] for s in qa_segments for r in s["cues"])
                             / max(1, sum(r["asr"]["refWords"] for s in qa_segments for r in s["cues"])), 3)
                       if asr is not None else None),
        },
        "segments": qa_segments,
    }
    (out_dir / "qa.json").write_text(json.dumps(qa, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    wall = time.perf_counter() - t_start
    log(f"wrote {shown(man_path)} and qa.json: {len(seg_results)} segments, "
        f"{qa['summary']['audioSeconds']:.1f}s audio, {qa['summary']['bytes'] / 1024:.0f} KiB, "
        f"{hits}/{n_cues} cues from cache, synth {synth_total:.1f}s (RTF {qa['summary']['rtf']}), wall {wall:.1f}s")
    for s in qa_segments:
        for r in s["cues"]:
            if r["flags"]:
                log(f"  flag {s['id']}/{r['id']}: {', '.join(r['flags'])}")
        if s["flags"]:
            log(f"  flag {s['id']}: {', '.join(s['flags'])}")
    if hard:
        log(f"FAILED: {hard} hard QA flag(s) {sorted(HARD_FLAGS)}")
        return 1
    if strict and n_flags:
        log(f"FAILED (--strict): {n_flags} QA flag(s)")
        return 1
    return 0


def preview(script_path: Path) -> int:
    from narr.g2p import BritishG2P, PronunciationDictionary

    data = json.loads(script_path.read_text(encoding="utf-8"))
    g = BritishG2P(PronunciationDictionary())
    bad = 0
    for seg in data.get("segments", []):
        for cue in seg.get("cues", []):
            o = g.convert(cue["text"])
            print(f"{seg['id']}/{cue['id']}: {cue['text']}")
            print(f"    audio:    {o.audio_text}")
            print(f"    phonemes: {o.phonemes}  ({len(o.phonemes)} symbols)")
            for w in o.warnings:
                print(f"    ! {w}")
                bad += "no phonemes" in w
    return 1 if bad else 0


# ---------------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------------
def selftest(engine: str, threads: int) -> int:
    import tempfile

    from narr.g2p import BritishG2P, PronunciationDictionary
    from narr.model import Kokoro

    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print(f"{'PASS' if cond else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")

    g = BritishG2P(PronunciationDictionary())
    o = g.convert("The CMOS inverter's gates sit on 193-nanometre polysilicon lines.")
    check("pronunciation dictionary and G2P", "sˈiːmɒs" in o.phonemes and not any("no phonemes" in w for w in o.warnings),
          o.phonemes)
    text = "A short bake finishes that reaction."
    ph = g.convert(text).phonemes
    k1 = Kokoro(threads=threads, engine=engine)
    a = k1.synthesize(ph, "bm_george")
    b = k1.synthesize(ph, "bm_george")
    k2 = Kokoro(threads=threads, engine=engine, verify=False)
    c = k2.synthesize(ph, "bm_george")
    check("deterministic within a session", np.array_equal(a.audio, b.audio))
    check("deterministic across sessions", np.array_equal(a.audio, c.audio))
    check("durations output present and consistent", a.durations is not None,
          f"{len(a.audio)} samples, {sum(a.durations or [])} frames")
    other = "quantized" if engine == "float-conv" else "float-conv"
    q = Kokoro(threads=threads, engine=other, verify=False).synthesize(ph, "bm_george")
    ratio = len(q.audio) / len(a.audio)
    check(f"{engine} vs {other}: same length within 2%", abs(ratio - 1) < 0.02, f"ratio {ratio:.4f}")
    with tempfile.TemporaryDirectory() as td:
        mp3 = Path(td) / "t.mp3"
        x = A.trim(a.audio).audio
        A.encode_mp3(x, mp3)
        d = A.decode(mp3)
        check("MP3 decodes to the exact PCM length", len(d) == len(x), f"{len(d)} vs {len(x)}")
        check("MP3 alignment lag is zero", A.best_lag(x, d) == 0)
        A.encode_mp3(x, Path(td) / "u.mp3")
        check("MP3 encoding is byte-identical on repeat", mp3.read_bytes() == (Path(td) / "u.mp3").read_bytes())
    print("self-test", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", type=Path, default=paths.REPO / "src" / "content" / "narration.json")
    ap.add_argument("--out", type=Path, default=paths.PUBLIC_OUT, help="output root (default public/narration)")
    ap.add_argument("--engine", default="float-conv", choices=["float-conv", "quantized"])
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--no-asr", action="store_true", help="skip the Moonshine transcription check")
    ap.add_argument("--strict", action="store_true", help="also fail on soft QA flags")
    ap.add_argument("--phonemes", action="store_true", help="print audio text and phonemes per cue; no audio")
    ap.add_argument("--selftest", action="store_true", help="run the pipeline self-test and exit")
    args = ap.parse_args()
    if args.selftest:
        return selftest(args.engine, args.threads)
    if args.phonemes:
        return preview(args.input)
    return build(args.input, args.out, args.engine, args.threads, not args.no_asr, args.strict)


if __name__ == "__main__":
    sys.exit(main())
