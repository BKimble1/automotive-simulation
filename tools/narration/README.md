# FAB / ONE narration pipeline

Offline text-to-speech tooling for the Watch (film) mode. It turns a narration script
(JSON, one entry per caption cue) into bundled MP3 files plus a manifest of measured
cue timings, using the Apache-2.0 **Kokoro-82M v1.0** model on the CPU. Nothing here
runs in the browser; the app only loads the files in `public/narration/<version>/`.

```sh
cd tools/narration
./setup.sh                                  # once: venv, pinned packages, model fetch + verify, self-test
./audition.sh                               # voice auditions  -> docs/audio/auditions/
./build.sh                                  # src/content/narration.json -> public/narration/<version>/
./build.sh example-narration.json           # the bundled 2-segment example
./build.sh my-script.json --phonemes        # check pronunciations only, no audio
./build.sh --selftest                       # determinism / encoder checks
```

## Two phases

**1. One-time model acquisition (needs network).** `setup.sh` creates `.venv`
(Python 3.11) and installs `requirements.txt` from PyPI, then `fetch_model.py`:

* downloads `expo-kokoro@1.1.9` from registry.npmjs.org, checks the tarball against the
  registry's `dist.integrity` (sha512) and `dist.shasum`, and verifies the registry's
  ECDSA signature over that integrity value with npm's published key;
* extracts **only** `build/kokoro-quantized.onnx` (92,361,116 bytes), `build/tokenizer.json`
  (the phoneme vocabulary), the voices we use (`bm_george`, `bm_fable`, `bm_lewis`,
  `bm_daniel`; float32 [510, 1, 256] each) and the package's LICENSE/README/package.json
  into `.cache/model/`;
* with `--asr` (setup does this by default) also fetches the optional QA recogniser:
  Moonshine-tiny ONNX from `@moonshine-ai/moonshine-js@0.1.29` (npm, same checks) and its
  `tokenizer.json` from the `useful-moonshine-onnx==20251121` wheel (sha256 from PyPI);
* records every extracted file's sha256 and size in `model-lock.json` (committed).

Hosts used: pypi.org, files.pythonhosted.org, registry.npmjs.org. Nothing is fetched
from huggingface.co or github.com (both are blocked in the environment this was built
in). `fetch_model.py --verify` re-checks `.cache` against the lock;
`fetch_model.py --offline` re-extracts from the tarballs kept in `.cache/downloads`.

**2. Synthesis (fully local).** `audition.sh` and `build.sh` need no network at all.
They check the model's sha256 against `model-lock.json` before every run.

## Outputs

| Path | Committed | Contents |
|---|---|---|
| `public/narration/<version>/<segmentId>.mp3` | yes | one file per segment, mono, 24 kHz, 64 kbps CBR, LAME/Xing gapless header, no ID3 tag |
| `public/narration/<version>/manifest.json` | yes | what the app reads (below) |
| `public/narration/<version>/qa.json` | yes | per-cue measurements, phonemes, flags |
| `docs/audio/auditions/*.mp3`, `report.md`, `report.json` | yes | voice auditions and their QA |
| `model-lock.json` | yes | provenance and hashes of every model file |
| `.cache/` | no | tarballs, extracted model, derived graph, per-cue WAV cache, segment/audition WAVs |
| `.venv/` | no | Python environment |

64 kbps mono is 8 KB per second: about **480 KB per minute** of narration.

## Narration script (input)

`src/content/narration.json` (the app will create it; `example-narration.json` shows the format):

```json
{
  "version": "film-1",
  "voice": "bm_george",
  "speed": 1.0,
  "segments": [
    { "id": "litho-expose", "leadIn": 0.2,
      "cues": [
        { "id": "light", "text": "In the scanner, 193-nanometre deep ultraviolet light passes through the reticle." },
        { "id": "shrink", "text": "The pattern is shrunk four times and projected onto the photoresist.", "pauseAfter": 0.45 }
      ],
      "tail": 0.8 }
  ]
}
```

* `version` names the output folder; bump it when the audio changes so browsers do not
  serve stale cached files. Letters, digits, `.`, `_`, `-`.
* A segment is `leadIn` (default 0) + cue 1 + its `pauseAfter` (default 0.35) + cue 2 +
  ... + the last cue + `tail` (default 0.6). The last cue's `pauseAfter` is not used.
* `text` is the exact caption. The pronunciation dictionary changes only what is spoken.
* Kokoro gives commas short pauses (about 0.05-0.2 s). For a real breath, end the cue
  and use `pauseAfter`.
* One sentence (or two short ones) per cue works best. The model reads at most 510
  phonemes per call; longer cues are split at sentence, then clause boundaries with a
  0.30 s / 0.15 s gap. Measured on the audition passage, six sentences read as one call
  came out about 10 % faster than the same sentences as separate cues.

## Manifest (output) and how timings are measured

```json
{ "version": "example-1", "voice": "bm_george", "speed": 1.0,
  "model": { "package": "expo-kokoro", "version": "1.1.9", "sha256": "fbae9257…",
             "name": "Kokoro-82M v1.0", "license": "Apache-2.0",
             "engine": "float-conv", "engineSha256": "2e83328b…" },
  "generatedAt": "2026-09-23T04:18:27Z",
  "audio": { "codec": "mp3", "sampleRate": 24000, "channels": 1, "bitrateKbps": 64, … },
  "segments": [ { "id": "intro", "file": "intro.mp3", "bytes": 82560, "sha256": "96a56ced…",
                  "durationMs": 10240,
                  "cues": [ { "id": "title", "text": "This is FAB / ONE.", "startMs": 300, "endMs": 1770 } ] } ],
  "licenses": [ … ] }
```

* `file` is relative to the manifest.
* Each cue's model output is trimmed to exactly 40 ms before the first and 80 ms after
  the last 10 ms frame above max(-65 dBFS, loudest frame - 50 dB), with 5 ms fades.
  `startMs`/`endMs` are the sample positions of that clip in the assembled segment
  (so speech starts 40 ms after `startMs`), rounded to milliseconds.
* Every MP3 is decoded back with ffmpeg. ffmpeg honours the LAME/Xing header, removing
  the encoder delay (576 + 529 samples) and end padding, so
  the decoded length equals the PCM length; the build checks that and cross-correlates
  decoded vs source audio to confirm zero lag. A non-zero lag would be added to every
  cue time and flagged `decode-mismatch`. `durationMs` is the decoded length.
* Checked in headless Chromium 141 (Playwright's build): `decodeAudioData` returns exactly
  the PCM length with zero lag (samples within 5e-5 of ffmpeg's decode), and an `<audio>`
  element reports `duration` equal to `durationMs`. Firefox and Safari were not available
  to test here; a decoder that ignored the gapless header would play everything about
  46 ms (1105 samples) late and report a slightly longer duration.
* `generatedAt` only changes when the manifest content changes, so an unchanged
  rebuild leaves every committed file byte-identical.

## Pronunciation dictionary (`pronunciations.json`)

Applied to each cue's text before G2P; captions never change. Keys are whole words or
phrases, matched on word boundaries, longest first. A key with an uppercase letter is
case-sensitive (`CMOS`), otherwise not (`resist` also matches `Resist`). Alphabetic keys
also match `-s`, `-es`, `-'s`, `-s'`, `-ed`, `-ing` (misaki's suffix rules are applied to
phoneme entries: `resist's` → `ɹɪzˈɪsts`). Each entry has exactly one of:

* `"say": "one ninety-three"`: a respelling substituted into the audio text, then read normally;
* `"phonemes": "sˈiːmɒs"`: Kokoro v1.0 / misaki British phonemes used verbatim, or an
  object keyed by `NOUN` / `VERB` / `ADJ` / `DEFAULT` for noun-verb pairs (`implant`).

Optional: `"note"` (documentation), `"caseSensitive"`, and `"asr"` (transcriptions the
QA recogniser may produce for the entry, e.g. `"sea moss"` for CMOS; QA only).
Symbols: `A`=eɪ `I`=aɪ `Q`=əʊ `W`=aʊ `Y`=ɔɪ `ʤ` `ʧ`, `ᵊ` light schwa, `a` TRAP, `ɑː` PALM,
`ɒ` LOT, `ɔː` THOUGHT, `ɜː` NURSE, `ː` long, `ˈ`/`ˌ` stress before the stressed vowel.
The loader rejects symbols outside that set. Check any script with `--phonemes`.

Decisions recorded in the file: CMOS "see-moss", NMOS "en-moss", PMOS "pee-moss", FOUP
"foop"; CMP, TMAH, HMDS, PEB, VDD read as letters (British "aitch"); CD-SEM "see-dee-sem";
GND is said "ground"; **DUV and EUV are read as letters**, so where the words "deep
ultraviolet" should be heard, write them in the script (caption and speech then match);
193 is said "one ninety-three" as lithographers do (captions keep the digits); 13.5 is
"thirteen point five"; nanometre(s) with British stress; dopant "DOH-punt", excimer
"EK-si-muh", ultraviolet "UL-truh-", polysilicon (not in the lexicon) pinned.

## How the audio is made

1. **G2P** (`narr/g2p.py`): dictionary → numbers to British words (`num2words`: "one
   hundred and ninety-three", 4-digit years as years) → misaki 0.9.4's English rules and
   **British gold/silver lexicons** → words the lexicon lacks go to misaki's espeak-ng
   fallback (`en-gb`). Kokoro v1.0 was trained on misaki phonemes, so this keeps its input
   in distribution. misaki normally tokenises and tags with spaCy's `en_core_web_sm`, which
   is only distributed from GitHub, so a small regex tokenizer and a heuristic tagger
   (determiners, prepositions, punctuation, noun/verb context for heteronyms) replace it.
   kokoro-onnx 0.6.1 was checked: it handles this graph's `input_ids`/float `speed`
   inputs but loads voices from one `.npz` (not expo-kokoro's per-voice raw files) and
   phonemizes with plain espeak IPA, so it is not used.
2. **Model** (`narr/model.py`): `input_ids` = phoneme ids wrapped in pad 0; `style` = row
   `n-1` of the voice pack for `n` phonemes (hexgrad's `KPipeline.infer` and kokoro-onnx
   0.6.1; the onnx-community README example uses row `n`, one row later; neighbouring rows
   differ very little); `speed` scales durations. Up to 510 phonemes per call; longer cues
   are split at sentence, then clause boundaries.
3. **Engine** (`narr/derive.py`): onnxruntime's `ConvInteger` kernel took 85 % of the
   bundled graph's CPU time (RTF ≈ 1). The default `float-conv` engine rewrites each
   `DynamicQuantizeLinear → ConvInteger → bias → Cast → Mul` chain as a float `Conv` whose
   weights are the same 8-bit values dequantized (`(Wq − zp)·scale`) and whose bias is the
   graph's own float bias; nothing else changes. Only activation rounding before those
   convolutions disappears. Checked layer by layer: fed identical inputs, every rewritten
   conv matches the quantized chain within 0.2-1.4 % (8-bit activation rounding); audition
   clips from both engines have the same length (±0.05 %), F0 and high-band energy. It is
   4-5× faster. `--engine quantized` runs the bundled graph exactly as shipped. Both
   engines also expose the duration predictor's per-token frame counts (600 samples each)
   as an extra output, used by QA to measure pauses. The derived graph (256 MB) lives
   only in `.cache`; its sha256 is recorded in each manifest.
4. **Assembly**: trim, join with the scripted pauses, one static gain per segment to
   **-18 LUFS** integrated (EBU R128, ffmpeg `ebur128`), true peak capped at -1.5 dBTP, no
   compression or limiting; LAME CBR 64 kbps via the static ffmpeg in `imageio-ffmpeg`.

**Deterministic:** the graph has no random ops; the same input, voice, speed, engine,
onnxruntime version and **thread count** give byte-identical WAVs and MP3s (verified:
a cold-cache rebuild in a new process reproduced the example's MP3s byte for byte).
Changing `--threads` changes samples by about 1e-6 (float summation order), so the
thread count is part of the cache key. CPUs with different SIMD support may differ at
the same level.

**Incremental:** raw model output is cached per cue in `.cache/cues/<engine>/`, keyed by
sha256 of: caption text, dictionary entries used, the phoneme string, voice id and voice
file hash, speed, model and engine hashes, onnxruntime version and threads. Editing one
sentence re-synthesises that sentence only (verified: 4 of 5 cues from cache, untouched
segment byte-identical). Delete `.cache/cues/` at any time to start clean.

## QA

`qa.json` has, per cue: start/end, the audio text and phonemes (with dictionary entries,
espeak-fallback words and G2P warnings), duration, spoken words per minute, phonemes per
second, peak, clipped samples, leading/trailing/longest internal silence, the model's own
pauses at each punctuation mark (length and depth below speech level), unpunctuated gaps
≥ 0.15 s, loudest 50 ms relative to the median (and at the onset), pitch median/range and
jumps > 7 semitones between 10 ms frames, isolated sample spikes, high-band energy share,
synthesis time, cache hit, and the ASR transcript with word-level differences.

Flags: **hard** (build exits 1): `no-phonemes-for-word`, `clipping`, `decode-mismatch`.
**Soft** (printed; `--strict` makes them fail): `rate-outlier` (phonemes/s more than 25 %
from the build's median, or outside 9-17), `long-internal-silence` (> 0.8 s), `onset-burst`
(> 12 dB), `raw-peak-over-full-scale`, `pitch-jumps` (> 30/min), `spikes`,
`very-short-cue` (< 0.6 s), `asr-mismatch` (WER > 0.25). Thresholds are in
`build_narration.py` and copied into `qa.json`.

**ASR check (optional):** Moonshine tiny (27M parameters, MIT) transcribes each cue (with
0.25 s of silence padding, which stops it inventing words at the start); the transcript is
compared with the caption and with the spoken text, keeping the closer. It is a rough
intelligibility proxy with its own errors: it writes "lethography" for "lithography" for
every voice, and changing only the padding moved single words in and out of its output.
Use it to find places to listen to, not as proof of pronunciation. `--no-asr` skips it.

**Nobody has listened to any of this audio yet.** All QA is automatic signal measurement.

## Performance (this machine: 4 vCPU, no GPU, shared with other jobs)

| Engine | Threads | RTF (inference seconds per audio second) |
|---|---|---|
| float-conv (default) | 4 | 0.23 on an idle machine; 0.44-0.46 while other jobs held the load average at 4-6 |
| float-conv | 2 | 0.35 idle, 0.34-0.36 under the same load |
| quantized (bundled graph) | 4 | 0.9-1.2 |

Per minute of narration with the default engine: about **14 s of synthesis** on an idle
machine (up to about 28 s when the CPU is shared), plus about 3 s for the optional ASR
check, about 1 s of model loading per run, and well under a second of loudness
measurement and encoding per segment. A 12-minute film is roughly 3.5 minutes from
scratch (about 6.5 on a busy machine); later edits only pay for the changed cues. On a
busy machine `--threads 2` degrades less, but it changes the cache key, so its first run
re-synthesises everything.

## Voices

All four requested British male voices are in the package: `bm_george`, `bm_fable`,
`bm_lewis`, `bm_daniel`. See `docs/audio/auditions/report.md`. On the measured criteria
`bm_george` at speed 1.0 comes first (the most even level: sentence onsets 5 dB above its
median speech level against 8-13 dB for the others; steady pace; clean pauses; 139 spoken
words per minute), with `bm_lewis` and `bm_daniel` within one rank point and `bm_fable`
clearly last (a noise/breath bed in its pauses, loud sentence onsets, a raw peak over full
scale). **The final choice needs a human listen.** Changing voice is one field in the script.

Qwen3-TTS (1.7B) was not attempted, as instructed: its weights are only on Hugging Face
(blocked here), and a 1.7B-parameter autoregressive model on 4 CPU cores was judged
impractical for this pipeline.

## Provenance and licenses

* `model-lock.json`: package, version, tarball URL, npm integrity + sha1, verified
  registry signature (key id, method), retrieval date, and the sha256 and size of every
  extracted file (TTS model, vocabulary, voices, ASR files).
* **Not verified against Hugging Face**: huggingface.co was unreachable (HTTP 403 from
  the egress proxy), so the hashes could not be compared with
  `onnx-community/Kokoro-82M-v1.0-ONNX`. Only the model's byte size (92,361,116, the size
  of `onnx/model_quantized.onnx` there) was compared. When possible, compare
  `model-lock.json` `model.sha256` and the voice hashes with the files on Hugging Face.
* Kokoro-82M v1.0 weights and voices: Apache-2.0 (hexgrad), `LICENSES/Kokoro-82M-Apache-2.0.txt`.
  expo-kokoro's own code: MIT (`LICENSES/expo-kokoro-MIT.txt`). misaki: Apache-2.0.
  espeak-ng, phonemizer-fork and the static FFmpeg are GPL build tools, run on the build
  machine only and never shipped. Moonshine (QA only): MIT. See `LICENSES/NOTICE.txt`.
* Every `manifest.json` carries a `licenses` list attributing the model.

## Limitations

* The model is the **8-bit quantized** export (the only one available offline here); the
  float-conv engine removes activation rounding but keeps 8-bit weights.
* **No human has listened.** The auditions, the ranking and the example build are judged
  by signal measurements and a small ASR model only.
* Hashes not compared with the official Hugging Face files (see above).
* G2P uses heuristic tagging instead of spaCy, so noun/verb heteronyms and "that" can be
  read with the wrong stress; pin any that matter in the dictionary. Words missing from
  misaki's lexicon use espeak-ng (listed per cue in `qa.json`).
* Kokoro's comma pauses are short; its phrasing cannot be steered other than through
  punctuation, cue boundaries and `speed`.

## Files

| File | Purpose |
|---|---|
| `setup.sh`, `audition.sh`, `build.sh` | entry points |
| `fetch_model.py` | one-time download, verification, extraction, `model-lock.json` |
| `audition.py` | voice auditions and `docs/audio/auditions/report.md` |
| `build_narration.py` | narration builds, `--phonemes` preview, `--selftest` |
| `narr/g2p.py` | dictionary, number normalisation, misaki without spaCy, espeak fallback |
| `narr/model.py` | Kokoro ONNX runner (vocab, style row, durations) |
| `narr/derive.py` | float-conv graph rewrite and duration output |
| `narr/pipeline.py` | per-cue cache, chunking, pause analysis, assembly, encode + decode check |
| `narr/audio.py` | trimming, loudness, MP3, signal QA (silences, pitch, bursts, spikes) |
| `narr/asr.py` | optional Moonshine-tiny transcription check |
| `pronunciations.json` | audio-only pronunciation dictionary |
| `example-narration.json` | two-segment example script |
| `requirements.txt` | exact pins (Python 3.11) |
| `model-lock.json` | provenance and hashes |
| `LICENSES/` | license texts and notices |
