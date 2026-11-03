#!/usr/bin/env python3
"""A drop-in for a `land.py`: `tally land <track> [--message FILE] [--verified-code SHA] [files...]`.

Same arguments, same refusals, same `<track> landed at <sha>` line. The repository
is TALLY_REPO, or the nearest folder above this script that holds
docs/records/config.json; the tally command is TALLY_CLI, filled in by the cut-over.
"""
import os
import sys
from pathlib import Path

TALLY = os.environ.get("TALLY_CLI") or "__TALLY_CLI__"
if TALLY == "__TALLY_CLI__":
    TALLY = "tally"


def repo_root() -> str:
    given = os.environ.get("TALLY_REPO")
    if given:
        return given
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs/records/config.json").exists():
            return str(parent)
    sys.exit("land.py: no docs/records/config.json above this script; set TALLY_REPO")


tally = TALLY.split()
os.execvp(tally[0], [*tally, "--repo", repo_root(), "land", *sys.argv[1:]])
