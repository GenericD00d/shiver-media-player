#!/usr/bin/env bash
# Type-checks the plugin's own code. The SDK is linked as source by `bun run setup`, so tsc also
# reports Sharkord's own errors from inside .repos/. Those aren't this plugin's to fix: they are
# counted, and only errors in this repo's files fail the check.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .repos/sharkord ]; then
  echo "the Sharkord SDK is missing: run bun run setup first" >&2
  exit 1
fi

status=0
out=$(bun run check-types 2>&1) || status=$?

# an error's first line names its file; the lines under it are indented
errors=$(grep -E 'error TS[0-9]+' <<<"$out" | grep -v '^[[:space:]]' || true)
ours=$(grep -v '^\.repos/' <<<"$errors" || true)

if [ "$status" -ne 0 ] && [ -z "$errors" ]; then
  printf '%s\n' "$out"
  echo "the type check did not run" >&2
  exit 1
fi

if [ -n "$ours" ]; then
  # each of this repo's errors with the lines under it, and none of Sharkord's
  printf '%s\n' "$out" | awk '/error TS[0-9]+/ && !/^[[:space:]]/ { ours = ($0 !~ /^\.repos\//) } ours { print }'
  exit 1
fi

echo "types: ok ($(grep -c . <<<"$errors" || true) errors inside the linked Sharkord SDK, which are Sharkord's)"
