#!/usr/bin/env bash
# Render the voice auditions and their QA report:
#   docs/audio/auditions/<voice>[_<speed>].mp3, report.md, report.json
# Fully offline once ./setup.sh has run. Extra options go to audition.py
# (e.g. --no-asr, --engine quantized, --threads 2).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$HERE/.venv/bin/python" ]; then
  echo "run $HERE/setup.sh first" >&2
  exit 1
fi
exec "$HERE/.venv/bin/python" "$HERE/audition.py" --compare-engines "$@"
