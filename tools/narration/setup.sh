#!/usr/bin/env bash
# One-time setup for the FAB / ONE narration pipeline.
#   1. creates .venv with Python 3.11 and installs the pinned packages (pypi.org)
#   2. fetches and verifies the model files (registry.npmjs.org, pypi.org) into .cache/
#   3. runs the pipeline self-test
# After this, auditions and builds run fully offline.
#
# Usage: ./setup.sh [--no-fetch] [--no-asr]
#   --no-fetch  only create the venv (e.g. no network for the registries)
#   --no-asr    skip the optional Moonshine ASR model used by QA
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

FETCH=1
ASR=--asr
for arg in "$@"; do
  case "$arg" in
    --no-fetch) FETCH=0 ;;
    --no-asr) ASR= ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.11 python3.12 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
"$PY" - <<'PYCHECK'
import sys
v = sys.version_info[:2]
if v not in ((3, 11), (3, 12)):
    sys.exit(f"Python 3.11 (or 3.12) is required, found {sys.version.split()[0]}; set PYTHON=/path/to/python3.11")
if v != (3, 11):
    print(f"note: pins were tested with Python 3.11; using {sys.version.split()[0]}", file=sys.stderr)
PYCHECK

if [ ! -x .venv/bin/python ]; then
  echo "creating .venv with $PY"
  "$PY" -m venv .venv
fi
.venv/bin/python -m pip install --disable-pip-version-check --quiet -r requirements.txt
echo "python packages installed"

if [ "$FETCH" = 1 ]; then
  .venv/bin/python fetch_model.py $ASR
  .venv/bin/python fetch_model.py --verify
  .venv/bin/python build_narration.py --selftest
fi
