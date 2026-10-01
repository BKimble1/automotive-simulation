#!/usr/bin/env bash
# Regenerate the film's narration: the script from the film's captions, the audio with the
# offline Kokoro pipeline (tools/narration), then the manifest the app imports.
#   scripts/narration.sh            (bump the version in src/content/narration-manifest.json first
#                                    when the audio changes, so browsers do not keep stale files)
set -euo pipefail
cd "$(dirname "$0")/.."
WRITE_NARRATION=1 npx vitest run src/content/film.test.ts -t "narration script" >/dev/null || true
VERSION=$(node -e "console.log(require('./src/content/narration.json').version)")
tools/narration/build.sh
cp "public/narration/$VERSION/manifest.json" src/content/narration-manifest.json
npx vitest run src/content/film.test.ts
