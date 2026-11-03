#!/usr/bin/env python3
"""Cut a repository over from a board.json ledger kept by scripts to tally (DESIGN.md §11, cut-over A).

    cutover_from_board.py --repo PATH --config PATH [--board PATH] [--tracks-dir PATH]
                          [--landing-dir PATH] [--keep PATH] [--tally-cli CMD]

Holds the old scripts' two locks (landing.lock in the landing dir, board.json.lock in the
tracks dir) for the whole sequence, so nothing lands or records while the ledger changes hands:
  1. the checkout is on main and clean; the old `ledger.py check` covers every commit on main
  2. tally init with the config, tally import board, tally ledger check
  3. parity, when the old status.py is there: its milestone shares and overall equal tally's
  4. the old ledger.py, land.py, status.py and board.json are copied to --keep, then the two
     wrappers from scripts/wrappers/ replace ledger.py and land.py (TALLY_CLI filled in) and
     status.py is patched to read docs/records/ledger.json and to pass over `records:` commits
Nothing is deleted; board.json stays where it was, frozen.
"""
import argparse
import fcntl
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATUS_PATCH = [
    ("\ndef collect():", '''
RECORDS = ROOT / "docs/records"


def load_board():
    """The ledger is docs/records/ledger.json (tally); board.json is read only when it is absent."""
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


def collect():'''),
    ("    board = json.loads(BOARD.read_text())\n", "    board = load_board()\n"),
    ('    unrecorded = [l for l in recent.splitlines() if l.split(" ", 1)[0][:7] not in known]\n',
     '    unrecorded = [l for l in recent.splitlines()\n'
     '                  if l.split(" ", 1)[0][:7] not in known and not l.partition(" ")[2].startswith("records:")]\n'),
    ('        problems.append("commits on main not in board.json (add them to the ledger): "\n',
     '        problems.append("commits on main not in the ledger (record them): "\n'),
]


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--board", type=Path)
    parser.add_argument("--tracks-dir", type=Path)
    parser.add_argument("--landing-dir", type=Path)
    parser.add_argument("--keep", type=Path)
    parser.add_argument("--tally-cli", default=f"node {HERE.parent / 'packages/cli/dist/main.js'}")
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    args.tracks_dir = (args.tracks_dir or args.repo / ".temp/tracks").resolve()
    args.landing_dir = (args.landing_dir or args.repo / ".temp/stage-b-resume").resolve()
    args.board = (args.board or args.tracks_dir / "board.json").resolve()
    args.keep = (args.keep or args.tracks_dir / f"ledger-preservation/pre-tally-{date.today().isoformat()}").resolve()
    return args


def patch_status(path: Path) -> None:
    text = path.read_text()
    for old, new in STATUS_PATCH:
        if text.count(old) != 1:
            print(f"status.py: {old.strip()!r} not found exactly once; left unpatched", file=sys.stderr)
            return
        text = text.replace(old, new)
    path.write_text(text)


def install(template: Path, target: Path, tally_cli: str) -> None:
    target.write_text(template.read_text().replace("__TALLY_CLI__", tally_cli))
    target.chmod(0o755)


def main() -> None:
    args = arguments()
    tally_cli = args.tally_cli.split()

    def git(*words: str) -> str:
        return subprocess.run(["git", *words], cwd=args.repo, capture_output=True, text=True, check=True).stdout.strip()

    def tally(*words: str, quiet: bool = False) -> str:
        done = subprocess.run([*tally_cli, "--repo", str(args.repo), *words], cwd=args.repo, capture_output=True, text=True)
        if not quiet:
            print(done.stdout.rstrip())
        if done.returncode:
            sys.exit(f"tally {' '.join(words)} failed ({done.returncode}): {done.stderr.strip()}")
        return done.stdout

    with open(args.landing_dir / "landing.lock", "a") as landing, open(args.tracks_dir / "board.json.lock", "a") as board_lock:
        fcntl.flock(landing, fcntl.LOCK_EX)
        if git("branch", "--show-current") != "main":
            sys.exit("checkout is not on main")
        if git("status", "--porcelain"):
            sys.exit("checkout has changes; cut-over refused")
        before = subprocess.run([sys.executable, str(args.tracks_dir / "ledger.py"), "check"], cwd=args.repo, capture_output=True, text=True)
        print(before.stdout.strip())
        if before.returncode:
            sys.exit("the old ledger misses a commit; record it first")
        fcntl.flock(board_lock, fcntl.LOCK_EX)
        board = json.loads(args.board.read_text())

        tally("init", "--config", str(args.config), "--baseline", board["baseline"])
        tally("import", "board", str(args.board))
        tally("ledger", "check")

        status_py = args.tracks_dir / "status.py"
        if status_py.exists():
            sys.path.insert(0, str(args.tracks_dir))
            import status as legacy  # noqa: PLC0415

            old = legacy.collect()
            new = json.loads(tally("status", "--json", quiet=True))
            old_shares = {r["id"]: round(r["share"], 9) for r in old["rows"]}
            new_shares = {r["id"]: round(r["share"], 9) for r in new["rows"]}
            if old_shares != new_shares or round(old["overall"], 9) != round(new["overall"], 9):
                sys.exit(f"parity failed: legacy {old_shares} {old['overall']}; tally {new_shares} {new['overall']}")
            print(f"parity: overall {new['overall']:.4%}, {len(new_shares)} milestones agree")

        args.keep.mkdir(parents=True, exist_ok=True)
        for source in (args.tracks_dir / "ledger.py", status_py, args.board, args.landing_dir / "land.py"):
            if source.exists():
                shutil.copy2(source, args.keep / source.name)
        install(HERE / "wrappers/ledger.py", args.tracks_dir / "ledger.py", args.tally_cli)
        install(HERE / "wrappers/land.py", args.landing_dir / "land.py", args.tally_cli)
        if status_py.exists():
            patch_status(status_py)
        print("main:", git("log", "-1", "--format=%h %s"))


if __name__ == "__main__":
    main()
