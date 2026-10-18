#!/usr/bin/env bash
# Validate and test Chroni and build the site.
# `./build.sh install` also installs the plugin from this folder; `./build.sh deploy` publishes chroni.web.app.
set -euo pipefail
cd "$(dirname "$0")"

claude plugin validate .

# The website's live demo runs the plugin's own trimming code.
node -e "const m=require('node:module'),fs=require('fs');fs.writeFileSync('site/squeeze.js','// Generated from hooks/squeeze.ts by build.sh. The same code the plugin runs.\\n'+m.stripTypeScriptTypes(fs.readFileSync('hooks/squeeze.ts','utf8')))" 2>/dev/null
claude plugin test .

if [[ "${1:-}" == "deploy" ]]; then
  firebase deploy --only hosting:chroni
fi

if [[ "${1:-}" == "install" ]]; then
  claude plugin marketplace add "$PWD" 2>/dev/null || true
  claude plugin install chroni@chroni
  echo "Installed. Run /reload-plugins in any open Claude Code session."
fi
