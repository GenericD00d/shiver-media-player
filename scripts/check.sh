#!/usr/bin/env bash
# The plugin's local checks, the same ones CI runs. Run before pushing:
#
#   scripts/check.sh           everything (needs Bun, and the network for the install and audit)
#   scripts/check.sh --quick   docs, versions and unit tests
#
# The type check needs the SDK from `bun run setup`, and is skipped without it.
set -euo pipefail
cd "$(dirname "$0")/.."

quick=false
[ "${1:-}" = "--quick" ] && quick=true

step() { printf '\n== %s\n' "$*"; }

step "Docs follow the standard"
python3 scripts/check-docs.py

step "Versions agree"
python3 scripts/check-version.py

step "Unit tests"
bun test

if $quick; then
  printf '\nQuick checks passed.\n'
  exit 0
fi

step "Install from the lockfile"
bun install --frozen-lockfile

step "Dependency audit"
bun audit

step "Types"
if [ -d .repos/sharkord ]; then
  scripts/check-types.sh
else
  echo "skipped: run bun run setup first"
fi

printf '\nAll checks passed.\n'
