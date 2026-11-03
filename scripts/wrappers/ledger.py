#!/usr/bin/env python3
"""The progress ledger is docs/records/ledger.json, kept by tally (2026-11-03).

This wrapper keeps the old command lines working by handing them to tally:

    ledger.py plan  <milestone> --track <track> <task> [<task> ...]   -> tally task plan ...
    ledger.py land  <milestone> <task> <commit> [--track <track>] [--also <commit> ...]
                                                                      -> tally task land ... (--also repeated)
    ledger.py wait  <milestone> <task> <what>                         -> tally task wait ...
    ledger.py other <commit> <note>                                   -> tally task other ...
    ledger.py check                                                   -> tally ledger check

tally prints the same line ledger.py printed, then `records: <sha>` for the docs-only
commit that saved the change on main. The ledger.py this replaced is kept at
.temp/tracks/ledger-preservation/pre-tally-2026-11-03/ledger.py; board.json there is frozen.
"""
import os
import sys

ROOT = "/path/to/repository"
TALLY = ROOT + "/.temp/tally/packages/cli/dist/main.js"


def spread_also(args):
    out, i = [], 0
    while i < len(args):
        if args[i] == "--also":
            i += 1
            while i < len(args) and not args[i].startswith("--"):
                out += ["--also", args[i]]
                i += 1
        else:
            out.append(args[i])
            i += 1
    return out


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 2
    verb, rest = args[0], args[1:]
    if verb == "check":
        command = ["ledger", "check", *rest]
    elif verb == "land":
        command = ["task", "land", *spread_also(rest)]
    elif verb in ("plan", "wait", "other"):
        command = ["task", verb, *rest]
    else:
        print(f"ledger.py: unknown verb {verb!r}; use plan, land, wait, other or check", file=sys.stderr)
        return 2
    os.execvp("node", ["node", TALLY, "--repo", ROOT, *command])


if __name__ == "__main__":
    sys.exit(main())
