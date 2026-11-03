#!/usr/bin/env python3
"""A drop-in for a `ledger.py` that kept a board.json: hands the same command lines to tally.

    ledger.py plan  <milestone> --track <track> <task> [<task> ...]   -> tally task plan ...
    ledger.py land  <milestone> <task> <commit> [--track <track>] [--also <commit> ...]
                                                                      -> tally task land ... (--also repeated)
    ledger.py wait  <milestone> <task> <what>                         -> tally task wait ...
    ledger.py other <commit> <note>                                   -> tally task other ...
    ledger.py check                                                   -> tally ledger check

The repository is TALLY_REPO, or the nearest folder above this script that holds
docs/records/config.json. The tally command is TALLY_CLI (for example
`node /path/to/tally/packages/cli/dist/main.js`); the cut-over script fills it in.
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
    sys.exit("ledger.py: no docs/records/config.json above this script; set TALLY_REPO")


def spread_also(args: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
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


def main() -> int:
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
    tally = TALLY.split()
    os.execvp(tally[0], [*tally, "--repo", repo_root(), *command])
    return 1


if __name__ == "__main__":
    sys.exit(main())
