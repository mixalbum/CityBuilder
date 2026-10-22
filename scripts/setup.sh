#!/usr/bin/env bash
# One-step setup on macOS or Linux. Run from the CityBuilder folder:
#   bash scripts/setup.sh
# Checks for Node.js 20+ and Git, installs the project's packages and runs an
# offline demo build to confirm everything works.
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1; }

if ! need node; then
  echo "Node.js is missing. Install the LTS:"
  if [[ "$(uname)" == Darwin ]]; then echo "  brew install node    (or download from https://nodejs.org)"; else echo "  https://nodejs.org, or your package manager (e.g. via nvm: nvm install --lts)"; fi
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if (( major < 20 )); then echo "Node.js $(node --version) is too old; install 20 or newer."; exit 1; fi
need git || { echo "Git is missing: https://git-scm.com/downloads"; exit 1; }

echo "Installing packages..."
npm install
echo "Checking with an offline demo build..."
npm run build:world -- melbourne --synthetic --preview

echo
echo "Ready. Build a real city, then open the viewer:"
echo '  npm run city -- "Wellington, New Zealand"'
echo '  npm run dev        (then open http://localhost:5173)'
