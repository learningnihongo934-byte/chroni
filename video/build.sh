#!/usr/bin/env bash
# Renders the 45-second Chroni video to out/chroni-45s.mp4.
# Needs Node, Google Chrome and ffmpeg (brew install ffmpeg).
# `./build.sh stills 3,12,40` renders single frames to out/ instead.
set -euo pipefail
cd "$(dirname "$0")"
[[ -d node_modules ]] || npm install --silent
if [[ "${1:-}" == "stills" ]]; then
  node render.mjs --stills "$2"
else
  node render.mjs
fi
