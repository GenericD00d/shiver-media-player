"""Fails unless manifest.json and package.json carry the same version, and CHANGELOG.md has it."""

import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
package = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]

if manifest != package:
    sys.exit(f"package.json has {package}, manifest.json has {manifest}")

# Each release has its changelog entry, written with the version bump.
changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")

if not re.search(rf"^## {re.escape(manifest)} \(", changelog, re.M):
    sys.exit(f"CHANGELOG.md has no '## {manifest} (<date>)' entry")

print(f"the version is {manifest}")
