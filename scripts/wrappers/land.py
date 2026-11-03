#!/usr/bin/env python3
"""The landing is tally's since 2026-11-03: `tally land <track> [--message FILE] [--verified-code SHA] [files...]`.

Same arguments, same refusals, same `<track> landed at <sha>` line; the lock is
.temp/tally/state/locks/landing.lock, which tally's records commits also take.
The land.py this replaced is kept at .temp/tracks/ledger-preservation/pre-tally-2026-11-03/land.py.
"""
import os
import sys

ROOT = "/path/to/repository"
TALLY = ROOT + "/.temp/tally/packages/cli/dist/main.js"

os.execvp("node", ["node", TALLY, "--repo", ROOT, "land", *sys.argv[1:]])
