#!/usr/bin/env bash
# Validate and test Chroni. `./build.sh install` also installs it from this folder.
set -euo pipefail
cd "$(dirname "$0")"

claude plugin validate .
claude plugin test .

if [[ "${1:-}" == "install" ]]; then
  claude plugin marketplace add "$PWD" 2>/dev/null || true
  claude plugin install chroni@chroni
  echo "Installed. Run /reload-plugins in any open Claude Code session."
fi
