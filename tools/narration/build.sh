#!/usr/bin/env bash
# Build the narration audio: public/narration/<version>/{<segment>.mp3,manifest.json,qa.json}
#
#   ./build.sh                                   uses src/content/narration.json
#   ./build.sh path/to/narration.json            another script
#   ./build.sh path/to/narration.json --phonemes preview phonemes only (no audio)
#   ./build.sh --selftest                        pipeline self-test
#
# Fully offline once ./setup.sh has run. Other options: --no-asr, --strict,
# --out DIR, --engine quantized, --threads N (see build_narration.py --help).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$HERE/.venv/bin/python" ]; then
  echo "run $HERE/setup.sh first" >&2
  exit 1
fi
exec "$HERE/.venv/bin/python" "$HERE/build_narration.py" "$@"
