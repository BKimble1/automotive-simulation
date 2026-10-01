"""Shared filesystem locations. Everything is relative to tools/narration/."""

from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # tools/narration
REPO = HERE.parent.parent                              # repository root
CACHE = HERE / ".cache"
LOCK = HERE / "model-lock.json"
PRONUNCIATIONS = HERE / "pronunciations.json"
LICENSES = HERE / "LICENSES"
CUE_CACHE = CACHE / "cues"                             # per-cue raw model output (float WAV)
AUDITION_WAV = CACHE / "auditions"                     # audition WAVs (not committed)
BUILD_WAV = CACHE / "build"                            # per-segment PCM before encoding
AUDITION_OUT = REPO / "docs" / "audio" / "auditions"  # committed audition MP3s + report
PUBLIC_OUT = REPO / "public" / "narration"             # committed narration builds
