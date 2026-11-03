#!/usr/bin/env python3
"""Cut-over A for Example (DESIGN.md §11): move the progress ledger into docs/records/ under tally.

Holds the tracks' two locks (land.py's landing.lock and ledger.py's board.json.lock) for the whole
sequence, so no track lands or records while the ledger changes hands:
  1. the operator checkout is on main and clean; the old ledger covers every commit on main
  2. tally init (the examples config) and tally import board; tally ledger check
  3. parity: the legacy status and tally's agree on every milestone's share and the overall
  4. the originals are kept under ledger-preservation/pre-tally-2026-11-03/, then
     ledger.py and land.py become wrappers and status.py reads docs/records/ledger.json
Nothing under .temp/ is deleted. board.json stays as a frozen record.
"""
import fcntl
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path("/path/to/repository")
TALLY = ROOT / ".temp/tally"
NODE = ["node", str(TALLY / "packages/cli/dist/main.js"), "--repo", str(ROOT)]
TRACKS = ROOT / ".temp/tracks"
RESUME = ROOT / ".temp/stage-b-resume"
KEEP = TRACKS / "ledger-preservation/pre-tally-2026-11-03"
STAGING = TALLY / "scripts/wrappers"


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def tally(*args, quiet=False):
    done = subprocess.run(NODE + list(args), cwd=ROOT, capture_output=True, text=True)
    if not quiet:
        print(done.stdout.rstrip())
    if done.returncode:
        sys.exit(f"tally {' '.join(args)} failed ({done.returncode}): {done.stderr.strip()}")
    return done.stdout


def patch_status(path):
    text = path.read_text()
    loader = '''
RECORDS = ROOT / "docs/records"


def load_board():
    """Since 2026-11-03 the ledger is docs/records/ledger.json (tally); board.json is read only when it is absent."""
    ledger_path = RECORDS / "ledger.json"
    if not ledger_path.exists():
        return json.loads(BOARD.read_text())
    ledger = json.loads(ledger_path.read_text())
    config = json.loads((RECORDS / "config.json").read_text())
    milestones = []
    for m in ledger["milestones"]:
        items = [{"id": t["id"], "track": t["track"], "commit": t.get("commit"),
                  **({"also": t["also"]} if t.get("also") else {}),
                  **({"waits": t["waits"]} if t.get("waits") else {})} for t in m["tasks"]]
        milestones.append({**{k: v for k, v in m.items() if k != "tasks"}, "items": items})
    return {"baseline": ledger["baseline"],
            "stage_weights": {s["id"]: s["weight"] for s in config["stages"]},
            "milestones": milestones,
            "other_commits": {o["commit"]: o["note"] for o in ledger["other"]}}


def collect():'''
    replacements = [
        ("\ndef collect():", loader),
        ("    board = json.loads(BOARD.read_text())\n", "    board = load_board()\n"),
        ('    unrecorded = [l for l in recent.splitlines() if l.split(" ", 1)[0][:7] not in known]\n',
         '    unrecorded = [l for l in recent.splitlines()\n'
         '                  if l.split(" ", 1)[0][:7] not in known and not l.partition(" ")[2].startswith("records:")]\n'),
        ('        problems.append("commits on main not in board.json (add them to the ledger): "\n',
         '        problems.append("commits on main not in the ledger (record them): "\n'),
    ]
    for old, new in replacements:
        if text.count(old) != 1:
            sys.exit(f"status.py: expected exactly one occurrence of {old!r}")
        text = text.replace(old, new)
    path.write_text(text)


def main():
    with open(RESUME / "landing.lock", "a") as landing, open(TRACKS / "board.json.lock", "a") as board_lock:
        fcntl.flock(landing, fcntl.LOCK_EX)
        if git("branch", "--show-current") != "main":
            sys.exit("operator checkout is not on main")
        if git("status", "--porcelain"):
            sys.exit("operator checkout has changes; cut-over refused")
        before = subprocess.run([sys.executable, str(TRACKS / "ledger.py"), "check"], cwd=ROOT, capture_output=True, text=True)
        print(before.stdout.strip())
        if before.returncode:
            sys.exit("the old ledger misses a commit; record it first")
        fcntl.flock(board_lock, fcntl.LOCK_EX)
        board = json.loads((TRACKS / "board.json").read_text())

        tally("init", "--config", str(TALLY / "examples/first-repository.config.json"), "--baseline", board["baseline"])
        tally("import", "board", str(TRACKS / "board.json"))
        tally("ledger", "check")

        sys.path.insert(0, str(TRACKS))
        import status as legacy
        old = legacy.collect()
        new = json.loads(tally("status", "--json", quiet=True))
        old_shares = {r["id"]: round(r["share"], 9) for r in old["rows"]}
        new_shares = {r["id"]: round(r["share"], 9) for r in new["rows"]}
        if old_shares != new_shares or round(old["overall"], 9) != round(new["overall"], 9):
            sys.exit(f"parity failed: legacy {old_shares} {old['overall']}; tally {new_shares} {new['overall']}")
        print(f"parity: overall {new['overall']:.4%}, {len(new_shares)} milestones agree; legacy problems {old['problems']}; tally problems {new['problems']}")

        KEEP.mkdir(parents=True, exist_ok=True)
        for source in (TRACKS / "ledger.py", TRACKS / "status.py", TRACKS / "board.json", RESUME / "land.py"):
            shutil.copy2(source, KEEP / source.name)
        shutil.copy2(STAGING / "ledger.py", TRACKS / "ledger.py")
        shutil.copy2(STAGING / "land.py", RESUME / "land.py")
        patch_status(TRACKS / "status.py")
        with open(TRACKS / "ledger-preservation/README.md", "a") as readme:
            readme.write("\n## Cut-over to tally (2026-11-03)\n\nThe ledger moved to `docs/records/ledger.json`, kept by tally "
                         "(`.temp/tally`). `ledger.py` and `land.py` are wrappers that exec tally; `status.py` reads the new ledger. "
                         "The scripts and board.json as they stood are in `pre-tally-2026-11-03/`; the five close-last checks are "
                         "tally's tests (`packages/core/tests/ledger/items.test.ts`, `ops.test.ts`). board.json is frozen.\n")
        print("main:", git("log", "-1", "--format=%h %s"))


if __name__ == "__main__":
    main()
