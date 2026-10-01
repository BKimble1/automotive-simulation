#!/usr/bin/env python3
"""Voice auditions for FAB / ONE narration.

Synthesises the same passage with bm_george, bm_fable, bm_lewis and bm_daniel at
speed 1.0, plus bm_george and bm_fable at 0.92, exactly the way build_narration.py
builds a film segment (one cue per sentence, 0.35 s pauses, 0.6 s tail, loudness
normalised to -18 LUFS). Writes:

    docs/audio/auditions/<voice>[_<speed>].mp3   mono 24 kHz 64 kbps
    docs/audio/auditions/report.md               QA tables, phonemes, recommendation
    docs/audio/auditions/report.json             the same numbers, machine-readable
    tools/narration/.cache/auditions/*.wav       16-bit WAV of every clip (not committed)

Nobody has listened to these clips: every number in the report is an automatic
signal measurement, and the recommendation is only as good as those measures.

Usage: .venv/bin/python audition.py [--engine float-conv|quantized] [--threads 4]
                                     [--compare-engines] [--no-asr]
"""

from __future__ import annotations

import argparse
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
    DEFAULT_PAUSE_AFTER, DEFAULT_TAIL, Narrator, assemble, count_phones, encode_and_verify, spoken_words,
)

PASSAGE = (
    "A single silicon wafer arrives at the lithography bay. First, the track spins it and spreads a "
    "thin film of photoresist across the surface. The scanner then shines 193-nanometre deep "
    "ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. Nothing "
    "is carved yet: the light only changes the resist's chemistry, leaving a hidden latent image. "
    "A short bake finishes that reaction. Then developer washes away the exposed positive resist, "
    "and the pattern opens. Only now can the plasma etch reach the polysilicon underneath. When the "
    "etch is done, the leftover resist is stripped, and the gates of a CMOS inverter remain."
)
PLAN = [("bm_george", 1.0), ("bm_fable", 1.0), ("bm_lewis", 1.0), ("bm_daniel", 1.0),
        ("bm_george", 0.92), ("bm_fable", 0.92)]
TARGET_WPM = (140.0, 170.0)   # usual documentary / explainer narration band


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def clip_name(voice: str, speed: float) -> str:
    return voice if speed == 1.0 else f"{voice}_{speed:g}"


def fmt(v, nd=1, dash="–"):
    if v is None:
        return dash
    if isinstance(v, float):
        return f"{v:.{nd}f}"
    return str(v)


def run_clip(nar: Narrator, voice: str, speed: float, sents: list[str], asr,
             out_dir: Path | None = None, wav_dir: Path | None = None) -> dict:
    t0 = time.perf_counter()
    cues = [nar.render(s, voice, speed) for s in sents]
    seg = assemble(cues, [DEFAULT_PAUSE_AFTER] * len(cues), 0.0, DEFAULT_TAIL)
    name = clip_name(voice, speed)
    wav = (wav_dir or paths.AUDITION_WAV) / f"{name}.wav"
    A.write_wav(wav, seg.pcm)
    mp3 = (out_dir or paths.AUDITION_OUT) / f"{name}.mp3"
    enc = encode_and_verify(seg.pcm, mp3)
    dec = enc.pop("_decoded")
    words = sum(spoken_words(c.g2p.audio_text) for c in cues)
    qa = A.analyze(seg.pcm, words=words)
    per = []
    for cue, (a, b) in zip(cues, seg.cue_samples):
        body = seg.pcm[a:b]
        s = A.analyze(body, words=spoken_words(cue.g2p.audio_text))
        ph_rate = count_phones(cue.g2p.phonemes) / max(1e-6, s["speechSpanS"])
        row = {
            "text": cue.text, "durationS": s["durationS"], "speechWpm": s.get("speechWpm"),
            "phonemesPerS": round(ph_rate, 2), "rawLeadS": round(cue.raw_lead_s, 3),
            "rawTailS": round(cue.raw_tail_s, 3), "pauses": cue.pauses,
            "hesitations": cue.hesitations,
            "rawPeakDbfs": cue.raw_peak_dbfs, "rawClipped": cue.raw_clipped,
            "tokens": cue.tokens, "synthS": round(cue.synth_seconds, 3), "cached": cue.cached,
            "pitchJumps": s["pitchJumpsPerMin"], "spikes": s["spikes"],
            "burstDb": s["burstDb"], "onsetBurstDb": s["onsetBurstDb"],
        }
        if asr is not None:
            row["asr"] = asr.check(body, cue.text, cue.g2p.audio_text, cue.g2p.asr_alternatives)
        per.append(row)
    raw_total = sum(c.raw_seconds for c in cues)
    synth_total = sum(c.synth_seconds for c in cues)
    # punctuation inside sentences (from the model's duration predictor)
    marks = [p for c in cues for p in c.pauses]
    paused = [p for p in marks if p["pauseS"] >= A.PAUSE_MIN_S]
    pause_lengths = [p["pauseS"] for p in marks]
    depths = [p["depthDb"] for p in paused]
    hes = [h for c in cues for h in c.hesitations]
    rates = [r["phonemesPerS"] for r in per]
    out = {
        "clip": name, "voice": voice, "speed": speed, "file": f"{name}.mp3",
        "encoded": enc, "loudness": seg.loudness, "qa": qa,
        "rtf": round(synth_total / raw_total, 3) if raw_total else None,
        "synthSeconds": round(synth_total, 2), "rawAudioSeconds": round(raw_total, 2),
        "allCached": all(c.cached for c in cues),
        "punctuationMarks": len(marks), "marksWithPause": len(paused),
        "meanModelPauseS": round(statistics.mean(pause_lengths), 3) if pause_lengths else None,
        "maxModelPauseS": round(max(pause_lengths), 3) if pause_lengths else None,
        "medianPauseDepthDb": round(statistics.median(depths), 1) if depths else None,
        "hesitations": len(hes), "hesitationSeconds": round(sum(d for _, d in hes), 2),
        "rateCv": round(statistics.pstdev(rates) / statistics.mean(rates), 3) if rates else None,
        "meanBurstDb": round(statistics.mean(r["burstDb"] for r in per), 1),
        "meanOnsetBurstDb": round(statistics.mean(r["onsetBurstDb"] for r in per), 1),
        "maxRawPeakDbfs": max(r["rawPeakDbfs"] for r in per),
        "decodedQa": {"peakDbfs": enc["decodedPeakDbfs"],
                      "clippedSamples": int(np.sum(np.abs(dec) >= 0.999))},
        "sentences": per,
        "wallSeconds": round(time.perf_counter() - t0, 2),
    }
    if asr is not None:
        errs = sum(r["asr"]["errors"] for r in per)
        n = sum(r["asr"]["refWords"] for r in per)
        out["asrWer"] = round(errs / n, 3) if n else None
    return out


def score(results: list[dict], have_asr: bool):
    """Rank the speed-1.0 voices on measurable criteria. Lower total = better.

    Each criterion has a tolerance: a clip is ranked below another only if it is
    worse by more than the tolerance, so differences inside measurement noise or
    below audibility (e.g. pauses at -68 vs -91 dB, both silent) do not count.
    Rank = 1 + number of clips better by more than the tolerance.
    """
    base = [r for r in results if r["speed"] == 1.0]
    crit = [
        ("artifacts: clipped samples + spikes + pitch jumps/min + sentences with raw peak > 0 dBFS", 0.0,
         lambda r: (r["qa"]["clippedSamples"] + r["qa"]["spikes"] + (r["qa"]["pitchJumpsPerMin"] or 0)
                    + sum(1 for s in r["sentences"] if s["rawPeakDbfs"] > 0))),
        ("sentence-onset level burst, dB over median speech (mean)", 2.0, lambda r: r["meanOnsetBurstDb"]),
        ("in-sentence punctuation marks without a ≥0.15 s pause", 1.0,
         lambda r: r["punctuationMarks"] - r["marksWithPause"]),
        ("pause depth, dB below speech (values under -50 count as clean silence)", 6.0,
         lambda r: max(-50.0, r["medianPauseDepthDb"] if r["medianPauseDepthDb"] is not None else 0.0)),
        ("speech rate outside 140-170 wpm, wpm", 5.0,
         lambda r: max(0.0, TARGET_WPM[0] - r["qa"]["speechWpm"], r["qa"]["speechWpm"] - TARGET_WPM[1])),
        ("pace variation between sentences (CV of phonemes/s)", 0.02, lambda r: r["rateCv"]),
        ("F0 range outside 6-12 semitones", 1.0,
         lambda r: max(0.0, 6 - (r["qa"]["f0RangeSemitones"] or 0), (r["qa"]["f0RangeSemitones"] or 0) - 12)),
    ]
    if have_asr:
        # 0.05: changing nothing but the silence padding around a clip moved single words
        # in and out of the transcript, so smaller differences are recogniser noise.
        crit.append(("ASR word error rate", 0.05, lambda r: r.get("asrWer") or 0.0))
    table = []
    for name, tol, fn in crit:
        vals = {r["clip"]: fn(r) for r in base}
        ranks = {c: 1 + sum(1 for o in vals.values() if o < v - tol - 1e-9) for c, v in vals.items()}
        table.append({"criterion": name, "tolerance": tol, "values": vals, "ranks": ranks})
    totals = {r["clip"]: sum(t["ranks"][r["clip"]] for t in table) for r in base}
    return table, totals


def recommend(results: list[dict], table: list[dict], totals: dict) -> tuple[str, str, float]:
    """Pick a voice (rank sum) and a speed (speech rate nearest the 140-170 wpm band)."""
    by = {r["clip"]: r for r in results}
    order = sorted(totals, key=lambda c: (totals[c], c))
    best = order[0]
    variants = [r for r in results if r["voice"] == by[best]["voice"]]

    def band_distance(r):
        w = r["qa"]["speechWpm"]
        return max(0.0, TARGET_WPM[0] - w, w - TARGET_WPM[1])

    speed_pick = min(variants, key=lambda r: (band_distance(r), abs(r["speed"] - 1.0)))
    b = by[best]
    lines = []
    ties = [c for c in order[1:] if totals[c] == totals[best]]
    lines.append(f"**Objective pick: `{b['voice']}` at speed {speed_pick['speed']:g}** "
                 f"(lowest rank sum, {totals[best]}, over the criteria above"
                 + (f"; tied with {', '.join(ties)} and chosen by name order, so treat it as a tie" if ties else
                    "; next: " + ", ".join(f"`{c}` {totals[c]}" for c in order[1:])) + ").")
    lines.append("")
    alone = [t["criterion"] for t in table
             if t["ranks"][best] == 1 and sum(1 for v in t["ranks"].values() if v == 1) == 1]
    lines.append(f"* Best on its own: {'; '.join(alone) or 'no single criterion'}; tied for first on "
                 f"{sum(1 for t in table if t['ranks'][best] == 1) - len(alone)} of the other criteria.")
    close = [c for c in order[1:] if totals[c] - totals[best] <= 1]
    if close:
        lines.append(f"* The margin is small: {', '.join(f'`{c}`' for c in close)} "
                     f"{'is' if len(close) == 1 else 'are'} within one rank point, so on these measures "
                     "they are close alternatives; listening should decide between them.")
    lines.append(f"* Speech rate {b['qa']['speechWpm']:.0f} wpm at 1.0"
                 + "".join(f", {r['qa']['speechWpm']:.0f} wpm at {r['speed']:g}" for r in variants if r['speed'] != 1.0)
                 + f"; the speed is chosen as the one closest to the {TARGET_WPM[0]:.0f}-{TARGET_WPM[1]:.0f} wpm "
                 "band usual for explainer narration (ties go to 1.0).")
    lines.append(f"* Pauses: {b['marksWithPause']} of {b['punctuationMarks']} in-sentence punctuation marks get "
                 f"≥ {A.PAUSE_MIN_S:.2f} s; median pause depth {b['medianPauseDepthDb']} dB below speech; "
                 f"{b['hesitations']} unpunctuated gaps ≥ 0.15 s. Kokoro gives commas short pauses "
                 "(≈0.05-0.2 s) with every voice, so longer breaths belong in the script as separate "
                 "cues (pauseAfter) rather than commas.")
    worst = []
    for r in results:
        if r["speed"] != 1.0 or r["clip"] == best:
            continue
        issues = []
        if r["medianPauseDepthDb"] is not None and r["medianPauseDepthDb"] > -35:
            issues.append(f"pauses are filled by a noise/breath bed (median depth {r['medianPauseDepthDb']} dB)")
        if r["maxRawPeakDbfs"] > 0:
            issues.append(f"raw output exceeds full scale (+{r['maxRawPeakDbfs']:.1f} dBFS)")
        if r["meanOnsetBurstDb"] > 10:
            issues.append(f"loud sentence onsets ({r['meanOnsetBurstDb']} dB over median speech on average)")
        if r["hesitations"]:
            issues.append(f"{r['hesitations']} unpunctuated gaps ≥ 0.15 s")
        if r["rateCv"] and r["rateCv"] > 0.06:
            issues.append(f"uneven pace between sentences (CV {r['rateCv']})")
        wpm = r["qa"]["speechWpm"]
        if wpm > TARGET_WPM[1] - 5:
            issues.append(f"fast ({wpm:.0f} wpm)")
        if issues:
            worst.append(f"`{r['voice']}`: " + "; ".join(issues))
    if worst:
        lines.append("* Measured concerns with the others: " + " · ".join(worst) + ".")
    lines.append("")
    lines.append("**Limits.** These criteria measure the signal, not the listening experience: they "
                 "cannot rank naturalness, warmth, accent, how well stress falls on the key word, or "
                 "whether a technical word sounds right (the ASR check is a rough proxy for that). "
                 "RTF differences between voices come from other jobs sharing this machine, not from "
                 "the voices. **A person needs to listen to the clips before the voice is final**; "
                 "if they prefer another voice, only `voice` (and maybe `speed`) in narration.json "
                 "changes.")
    return "\n".join(lines), b["voice"], speed_pick["speed"]


def asr_findings(results: list[dict]) -> list[dict]:
    rows: dict[tuple, dict] = {}
    for r in results:
        if r["speed"] != 1.0:
            continue
        for i, s in enumerate(r["sentences"], 1):
            for exp, heard in (s.get("asr") or {}).get("diffs", []):
                key = (i, exp, heard)
                rows.setdefault(key, {"sentence": i, "expected": exp, "heard": heard, "voices": []})
                rows[key]["voices"].append(r["voice"])
    return sorted(rows.values(), key=lambda x: (x["sentence"], -len(x["voices"]), x["expected"]))


def write_report(results, table, totals, nar: Narrator, missing, engine_cmp, asr_info, g2p_rows) -> None:
    lock = nar.model.lock
    fp = nar.fingerprint()
    L = []
    L.append("# Narration voice auditions")
    L.append("")
    L.append("> **No human has listened to these clips yet.** Everything below is an automatic "
             "measurement of the signal. It can catch clipping, clicks, pitch glitches, dropped "
             "words, odd pauses and rate problems, but it cannot judge naturalness, accent or "
             "whether a word *sounds* right. The final voice choice needs a person to listen.")
    L.append("")
    L.append(f"Passage ({A.count_words(PASSAGE)} written words, "
             f"{sum(spoken_words(nar.g2p.convert(x).audio_text) for x in sentences(PASSAGE))} spoken: "
             "'193' is read 'one ninety-three'), one cue per sentence, "
             f"{DEFAULT_PAUSE_AFTER:.2f} s between sentences, {DEFAULT_TAIL:.1f} s tail, each clip "
             f"normalised to {A.TARGET_LUFS:.0f} LUFS (true peak ≤ {A.TRUE_PEAK_CEILING} dBTP), "
             "mono 24 kHz MP3 at 64 kbps.")
    L.append("")
    L.append(f"* Model: `{lock['package']}@{lock['version']}` → Kokoro-82M v1.0 quantized ONNX, "
             f"sha256 `{lock['model']['sha256'][:16]}…`")
    L.append(f"* Engine: `{fp['engine']}` (graph sha256 `{fp['engineSha256'][:16]}…`), "
             f"onnxruntime {fp['onnxruntime']}, {fp['threads']} threads, CPU only")
    g = fp["g2p"]
    L.append(f"* G2P: misaki {g['misaki']} British lexicon + espeak-ng {g['espeak-ng']} fallback "
             f"(`en-gb`), pronunciation dictionary `tools/narration/pronunciations.json`")
    L.append(f"* Voices requested: {', '.join(sorted({v for v, _ in PLAN}))}. "
             + (f"**Missing from the package: {', '.join(missing)}.**" if missing else "All present in the package."))
    if asr_info:
        L.append(f"* ASR check: {asr_info}")
    L.append("")
    L.append("## Clip summary")
    L.append("")
    hdr = ["Clip", "Duration s", "WPM (whole clip)", "Speech WPM", "Peak dBFS", "Clipping",
           "Longest internal silence s", "Leading / trailing silence s", "Median F0 Hz",
           "F0 range st", "Pitch jumps /min", "Spikes", "HF share dB", "RTF"]
    if any("asrWer" in r for r in results):
        hdr.append("ASR WER")
    L.append("| " + " | ".join(hdr) + " |")
    L.append("|" + "---|" * len(hdr))
    for r in results:
        q = r["qa"]
        row = [f"[{r['clip']}]({r['file']})", fmt(q["durationS"], 2), fmt(q["wpm"]), fmt(q["speechWpm"]),
               fmt(q["peakDbfs"], 1), "yes" if q["clippedSamples"] or r["decodedQa"]["clippedSamples"] else "no",
               fmt(q["longestInternalSilenceS"], 2), f"{q['leadingSilenceS']:.2f} / {q['trailingSilenceS']:.2f}",
               fmt(q["f0MedianHz"]), fmt(q["f0RangeSemitones"]), fmt(q["pitchJumpsPerMin"]),
               str(q["spikes"]), fmt(q["hfShareDb"]), fmt(r["rtf"], 3)]
        if "asrWer" in r:
            row.append(fmt(r["asrWer"], 3))
        L.append("| " + " | ".join(row) + " |")
    L.append("")
    L.append("How to read it:")
    L.append("")
    L.append("* **WPM (whole clip)** counts spoken words over the whole clip, including the 0.35 s "
             "sentence gaps and the 0.6 s tail; **Speech WPM** divides by the span from the first to "
             "the last speech frame.")
    L.append("* **Longest internal silence** is the longest run of 10 ms frames below "
             f"{A.SILENCE_DB:.0f} dBFS between the first and last speech frame. It includes the "
             "0.35 s sentence gaps (plus the 40 ms/80 ms trim margins), so ~0.45-0.5 s is expected; "
             "anything well above that is a pause the model made itself.")
    L.append("* **Leading / trailing silence** of the finished clip: 0.04 s lead margin (trim) and "
             "0.6 s tail + 0.08 s margin by construction. The model's own silences before trimming "
             "are in the per-sentence tables.")
    L.append("* **Pitch jumps** are jumps of more than 7 semitones between adjacent voiced 10 ms "
             "frames of an autocorrelation pitch track: a crude detector for cracks or octave "
             "glitches (and for pitch-tracker mistakes on creaky voice).")
    L.append("* **Spikes** counts isolated sample discontinuities (clicks). **HF share** is the "
             "energy above 8 kHz relative to all energy during speech: higher means brighter, "
             "more sibilant or hissier audio.")
    L.append("* **RTF** = inference time / audio produced, on this 4-core CPU "
             "(from the per-cue cache records when a clip was re-rendered from cache).")
    L.append("* Every MP3 was decoded back with ffmpeg: decoded length equals the source length "
             "and the alignment lag is 0 for every clip (see report.json).")
    L.append("")
    asr_rows = asr_findings(results)
    if asr_rows:
        L.append("## ASR findings")
        L.append("")
        L.append("Word-level differences between the script and the Moonshine-tiny transcription, "
                 "grouped over the speed-1.0 clips. A difference heard for every voice points at the "
                 "text, the G2P or the recogniser's vocabulary; one heard for a single voice points at "
                 "that voice. Treat these as places to listen first, not as verdicts.")
        L.append("")
        L.append("| Sentence | Expected | Transcribed | Voices |")
        L.append("|---|---|---|---|")
        for row in asr_rows:
            L.append(f"| {row['sentence']} | {row['expected']} | {row['heard']} | {', '.join(row['voices'])} |")
        L.append("")
    L.append("## Pause behaviour of the model")
    L.append("")
    L.append("Read from the model's own duration predictor (exposed as an extra graph output; "
             "25 ms per frame): the time given to each comma, colon, semicolon or dash inside a "
             "sentence (plus the following word gap), whether that reaches "
             f"{A.PAUSE_MIN_S:.2f} s, how far the signal drops during those pauses relative to the "
             "sentence's speech level (about -60 dB is clean silence; above about -35 dB means "
             "breath or a noise bed fills the pause), and word gaps of 150 ms or more where there "
             "is no punctuation (unpunctuated gaps; these can be natural phrase breaks).")
    L.append("")
    L.append("The last three columns: variation of the speaking rate between sentences (coefficient "
             "of variation of phonemes per second), the loudest 50 ms of each sentence and the loudest "
             "50 ms of its first half second, both in dB above the sentence's median speech level "
             "(mean over sentences; even narration sits around 5-8 dB), and the highest raw model "
             "peak before gain (above 0 dBFS means the model itself overshot full scale).")
    L.append("")
    L.append("| Clip | Marks | Marks with ≥0.15 s pause | Mean pause s | Longest pause s | Median pause depth dB | Unpunctuated gaps (total s) | Rate CV | Burst dB | Onset burst dB | Max raw peak dBFS |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        L.append(f"| {r['clip']} | {r['punctuationMarks']} | {r['marksWithPause']} | "
                 f"{fmt(r['meanModelPauseS'], 2)} | {fmt(r['maxModelPauseS'], 2)} | "
                 f"{fmt(r['medianPauseDepthDb'])} | {r['hesitations']} ({fmt(r['hesitationSeconds'], 2)}) | "
                 f"{fmt(r['rateCv'], 3)} | {fmt(r['meanBurstDb'])} | {fmt(r['meanOnsetBurstDb'])} | "
                 f"{fmt(r['maxRawPeakDbfs'])} |")
    L.append("")
    if engine_cmp:
        L.append("## Engine check: bundled quantized graph vs float-conv graph")
        L.append("")
        L.append("The default engine rewrites the bundled graph's ConvInteger chains as float "
                 "convolutions over the same 8-bit weights (see `narr/derive.py`). Same clip, both engines:")
        L.append("")
        L.append("| Engine | Duration s | Speech WPM | Peak dBFS | F0 median | F0 range st | Pitch jumps /min | Spikes | HF share dB | RTF |")
        L.append("|---|---|---|---|---|---|---|---|---|---|")
        for label, r in engine_cmp:
            q = r["qa"]
            L.append(f"| {label} | {fmt(q['durationS'], 2)} | {fmt(q['speechWpm'])} | {fmt(q['peakDbfs'])} | "
                     f"{fmt(q['f0MedianHz'])} | {fmt(q['f0RangeSemitones'])} | {fmt(q['pitchJumpsPerMin'])} | "
                     f"{q['spikes']} | {fmt(q['hfShareDb'])} | {fmt(r['rtf'], 3)} |")
        L.append("")
    L.append("## Objective ranking (speed 1.0 clips)")
    L.append("")
    clips = [r["clip"] for r in results if r["speed"] == 1.0]
    L.append("Each criterion is ranked with a tolerance: a clip only ranks below another if it is "
             "worse by more than the tolerance (rank = 1 + number of clips better by more than it), "
             "so differences inside measurement noise or below audibility do not count (the ASR "
             "tolerance is wide because changing only the silence padding around a clip moved "
             "single words in and out of Moonshine's transcript). Unpunctuated "
             "gaps and high-band share are reported above but not ranked: a gap at a phrase boundary "
             "can be natural, and brightness is partly timbre.")
    L.append("")
    L.append("| Criterion (lower is better) | Tolerance | " + " | ".join(clips) + " |")
    L.append("|---|---|" + "---|" * len(clips))
    for t in table:
        cells = [f"{fmt(t['values'][c], 3) if isinstance(t['values'][c], float) else t['values'][c]} (#{t['ranks'][c]})" for c in clips]
        L.append(f"| {t['criterion']} | {t['tolerance']:g} | " + " | ".join(cells) + " |")
    L.append("| **Rank sum** | | " + " | ".join(f"**{totals[c]}**" for c in clips) + " |")
    L.append("")
    rec_text, best_voice, best_speed = recommend(results, table, totals)
    L.append("## Recommendation")
    L.append("")
    L.append(rec_text)
    L.append("")
    L.append("## Phonemes per sentence")
    L.append("")
    L.append("Identical for every voice (G2P does not depend on the voice). `[word]` marks a "
             "pronunciation-dictionary entry; the phonemes are Kokoro/misaki symbols "
             "(A = eɪ, I = aɪ, Q = əʊ, W = aʊ, Y = ɔɪ, ᵊ = light schwa, ˈ ˌ = stress). Words the "
             "British lexicon did not know went to espeak-ng and are listed, as are any warnings.")
    L.append("")
    n_fb = sum(row["sources"].count("espeak:") for row in g2p_rows)
    n_warn = sum(len(row["warnings"]) for row in g2p_rows)
    L.append(f"Automatic G2P checks for this passage: {n_fb} sentence(s) with espeak-ng fallback words, "
             f"{n_warn} G2P warning(s) (unknown words, all-caps words missing from the dictionary, "
             "symbols outside the British set).")
    L.append("")
    for i, row in enumerate(g2p_rows, 1):
        L.append(f"{i}. {row['text']}")
        L.append(f"   * audio text: {row['audio_text']}")
        L.append(f"   * phonemes: `{row['phonemes']}`")
        L.append(f"   * sources: {row['sources']}")
        for w in row["warnings"]:
            L.append(f"   * ⚠ {w}")
    L.append("")
    L.append("## Per-sentence measurements")
    L.append("")
    for r in results:
        L.append(f"### {r['clip']}")
        L.append("")
        hdr = ["#", "Duration s", "Speech WPM", "Phonemes/s", "Model lead / tail silence s",
               "Pauses at punctuation (mark length s / depth dB)", "Unpunctuated gaps [t s, length s]",
               "Raw peak dBFS", "Tokens", "Synth s"]
        has_asr = "asr" in r["sentences"][0]
        if has_asr:
            hdr.append("ASR hypothesis (errors/words)")
        L.append("| " + " | ".join(hdr) + " |")
        L.append("|" + "---|" * len(hdr))
        for i, s in enumerate(r["sentences"], 1):
            row = [str(i), fmt(s["durationS"], 2), fmt(s["speechWpm"]), fmt(s["phonemesPerS"]),
                   f"{s['rawLeadS']:.2f} / {s['rawTailS']:.2f}",
                   ", ".join(f"{p['mark']} {p['pauseS']:.2f} / {p['depthDb']:.0f}" for p in s["pauses"]) or "–",
                   ", ".join(f"[{t:.2f}, {d:.2f}]" for t, d in s["hesitations"]) or "none",
                   fmt(s["rawPeakDbfs"]), str(s["tokens"]), fmt(s["synthS"], 2)]
            if has_asr:
                a = s["asr"]
                row.append(f"{a['hypothesis']} ({a['errors']}/{a['refWords']})")
            L.append("| " + " | ".join(row) + " |")
        L.append("")
    (paths.AUDITION_OUT / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    return best_voice, best_speed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default="float-conv", choices=["float-conv", "quantized"])
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--compare-engines", action="store_true",
                    help="also render bm_george @1.0 with the other engine for the report")
    ap.add_argument("--no-asr", action="store_true", help="skip the Moonshine transcription check")
    args = ap.parse_args()

    nar = Narrator(engine=args.engine, threads=args.threads)
    have = set(nar.model.lock.get("voices", []))
    missing = sorted({v for v, _ in PLAN if v not in have})
    asr = None
    asr_info = ""
    if not args.no_asr:
        from narr import asr as asr_mod

        asr = asr_mod.load_if_available()
        asr_info = asr.describe() if asr else "not available (run fetch_model.py --asr); skipped"
    sents = sentences(PASSAGE)
    g2p_rows = []
    for s in sents:
        o = nar.g2p.convert(s)
        src = {}
        for w in o.words:
            if w.source not in ("punctuation",):
                src.setdefault(w.source, []).append(w.text)
        g2p_rows.append({
            "text": s, "audio_text": o.audio_text, "phonemes": o.phonemes,
            "sources": "; ".join(f"{k}: {', '.join(v)}" for k, v in sorted(src.items()) if k != "lexicon-gold")
                       + f"; lexicon-gold: {len(src.get('lexicon-gold', []))} words",
            "warnings": o.warnings,
        })
    results = []
    for voice, speed in PLAN:
        if voice in missing:
            print(f"skip {voice}: not in the package", file=sys.stderr)
            continue
        r = run_clip(nar, voice, speed, sents, asr)
        q = r["qa"]
        print(f"{r['clip']:16s} {q['durationS']:6.2f}s  speech {q['speechWpm']:.0f} wpm  peak {q['peakDbfs']:.1f} dBFS"
              f"  RTF {r['rtf']}  {'(cached)' if r['allCached'] else ''}", file=sys.stderr)
        results.append(r)

    engine_cmp = []
    if args.compare_engines:
        other = "quantized" if args.engine == "float-conv" else "float-conv"
        base = next(r for r in results if r["clip"] == "bm_george")
        nar2 = Narrator(engine=other, threads=args.threads)
        side = paths.AUDITION_WAV / other   # the comparison clip stays out of docs/
        r2 = run_clip(nar2, "bm_george", 1.0, sents, None, out_dir=side, wav_dir=side)
        engine_cmp = [(f"{args.engine} (default)", base), (other, r2)]

    table, totals = score(results, asr is not None)
    best_voice, best_speed = write_report(results, table, totals, nar, missing, engine_cmp, asr_info, g2p_rows)
    best = {"voice": best_voice, "speed": best_speed}
    report = {
        "passage": PASSAGE, "plan": PLAN, "missingVoices": missing, "fingerprint": nar.fingerprint(),
        "results": results, "ranking": {"criteria": table, "totals": totals, "recommended": best},
        "engineComparison": [{"label": l, "clip": r} for l, r in engine_cmp],
    }
    (paths.AUDITION_OUT / "report.json").write_text(json.dumps(report, indent=1, default=float) + "\n")
    print(f"recommended (objective): {best}  rank sums: {totals}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
