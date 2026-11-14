"""Builds the repository the evaluation questions in tally.xml are asked about.

    python3 evaluations/fixture.py <empty folder> [path to packages/cli/dist/main.js]

It makes a small git repository with fixed commit dates, starts tally's records in it, and fills
them through the MCP tools: milestones, tasks, waits, landings, run records, questions, decisions,
context entries, the rulebook (adopted, two rules tailored, one retired), two phases (the first closed), a hand-off,
reviews (one left open), parked parts, an edited question and a question given its number. Run it again on a fresh
folder and the answers are the same.
"""
import json, os, subprocess, sys
from pathlib import Path

REPO = Path(sys.argv[1]).resolve()
CLI = str(Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "packages/cli/dist/main.js").resolve())
WHEN = {"GIT_AUTHOR_DATE": "2026-03-02T09:00:00Z", "GIT_COMMITTER_DATE": "2026-03-02T09:00:00Z", "GIT_AUTHOR_NAME": "Lumen", "GIT_AUTHOR_EMAIL": "lumen@example.com", "GIT_COMMITTER_NAME": "Lumen", "GIT_COMMITTER_EMAIL": "lumen@example.com"}
HOME = REPO.parent / (REPO.name + "-tally-home")
ENV = {**os.environ, **WHEN, "TALLY_HOME": str(HOME)}
ENV.pop("TALLY_URL", None)

def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout.strip()

def tally(*args):
    done = subprocess.run(["node", CLI, "--repo", str(REPO), *args], env=ENV, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f"tally {' '.join(args)}: {done.stderr or done.stdout}")
    return done.stdout.strip()

def commit(path, text, message):
    file = REPO / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)
    git("add", "--", path)
    git("commit", "-q", "-m", message)
    return git("rev-parse", "--short=7", "HEAD")

class Mcp:
    def __init__(self):
        self.proc = subprocess.Popen(["node", CLI, "--repo", str(REPO), "mcp"], env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.n = 0
        self.send("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "fixture", "version": "0"}})
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); self.proc.stdin.flush()
    def send(self, method, params):
        self.n += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n"); self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if line == "":
                raise SystemExit("the server closed: " + self.proc.stderr.read())
            answer = json.loads(line)
            if answer.get("id") == self.n:
                return answer
    def call(self, tool, /, **args):
        answer = self.send("tools/call", {"name": tool, "arguments": args})
        result = answer.get("result") or {}
        if "error" in answer or result.get("isError"):
            raise SystemExit(f"{tool} failed: {json.dumps(answer)[:700]}")
        return result.get("structuredContent") or {}

REPO.mkdir(parents=True, exist_ok=True)
if any(REPO.iterdir()):
    raise SystemExit(f"{REPO} is not empty")
git("init", "-q", "-b", "main")
(REPO / ".gitignore").write_text(".temp/\n")
git("add", "-A"); git("commit", "-q", "-m", "chore: start")
config = {
    "schema": 1, "name": "Lumen", "mainBranch": "main", "context": "records",
    "tracks": [
        {"name": "data", "worktree": ".temp/worktrees/data", "branch": "track/data", "paths": ["crates/store"]},
        {"name": "engine", "worktree": ".temp/worktrees/engine", "branch": "track/engine", "paths": ["crates/engine"]},
        {"name": "web", "worktree": ".temp/worktrees/web", "branch": "track/web", "paths": ["ui"]},
    ],
    "stages": [{"id": "A", "name": "foundation", "weight": 40}, {"id": "B", "name": "product", "weight": 60}],
    "commands": {"test": ["cargo", "test", "--locked"]},
    "fingerprint": {"paths": ["crates", "ui"], "exclude": []},
    "identity": {"name": "Lumen", "email": "lumen@example.com"},
    "records": {"dir": "docs/records", "commitPrefix": "records:", "commit": False},
    "locks": ["evidence-host"],
}
(REPO.parent / (REPO.name + "-config.json")).write_text(json.dumps(config))
tally("init", "--config", str(REPO.parent / (REPO.name + "-config.json")))
git("add", "-A"); git("commit", "-q", "-m", "records: start")
log_format = commit("crates/store/src/wal.rs", "// the log\n", "feat(store): the log's record format")
snapshots = commit("crates/store/src/snapshot.rs", "// snapshots\n", "feat(store): snapshot files")
shell = commit("ui/src/shell.tsx", "// the shell\n", "feat(web): the dashboard's shell")
for track in ("data", "engine", "web"):
    git("worktree", "add", "-q", str(REPO / ".temp/worktrees" / track), "-b", f"track/{track}", "main")

m = Mcp()
op = m.call("session_open", worktree=str(REPO), agent="operator")["id"]
data = m.call("session_open", worktree=str(REPO / ".temp/worktrees/data"), agent="ada")["id"]
m.call("project_set", sessionId=op, purpose="Lumen stores event streams and shows them on a dashboard.", stack=["Rust", "TypeScript"],
       layout=[{"path": "crates/store", "what": "the record store"}, {"path": "crates/engine", "what": "the job scheduler"}, {"path": "ui", "what": "the dashboard"}],
       glossary=[{"term": "segment", "means": "one append-only file of the log"}, {"term": "snapshot", "means": "the store's state at one log position"}])
m.call("milestone_add", sessionId=op, id="A1", stage="A", name="record store", track="data", weight=3, delivers=[
    {"id": "wal", "what": "the write-ahead log", "paths": ["crates/store/src/wal.rs"]}, {"id": "snapshot", "what": "snapshot files"}, {"id": "compaction", "what": "compaction of old segments"}])
m.call("milestone_add", sessionId=op, id="A2", stage="A", name="scheduler", track="engine", weight=2, delivers=[{"id": "queue", "what": "the job queue"}])
m.call("milestone_add", sessionId=op, id="B1", stage="B", name="dashboard", track="web", weight=5)
m.call("milestone_add", sessionId=op, id="B2", stage="B", name="exports", track="data+web", weight=4, waits="the export format's sign-off")
m.call("task_plan", sessionId=op, milestone="A1", track="data", tasks=[
    {"id": "1 log format", "brief": "fix the record layout of the log", "paths": ["crates/store/src/wal.rs"], "covers": ["wal"]},
    {"id": "2 snapshots", "brief": "write and read snapshot files", "paths": ["crates/store/src/snapshot.rs"], "covers": ["snapshot"]},
    {"id": "3 recovery", "brief": "replay the log after a crash", "paths": ["crates/store/src/recover.rs"]},
    {"id": "4 checksums", "brief": "checksum every snapshot", "paths": ["crates/store/src/snapshot.rs"]}])
m.call("task_plan", sessionId=op, milestone="A2", track="engine", tasks=[{"id": "1 scheduler", "brief": "one queue, one worker", "covers": ["queue"]}, "2 backoff"])
m.call("task_plan", sessionId=op, milestone="B1", track="web", tasks=["1 shell", "2 charts", "3 filters"])
m.call("task_plan", sessionId=op, milestone="B2", track="data", tasks=["1 csv export"])
m.call("task_wait", sessionId=op, milestone="A1", task="3 recovery", what="the worker it runs on", on="A2:1 scheduler")
m.call("task_wait", sessionId=op, milestone="A2", task="2 backoff", what="the retry policy", on="B9:retries")
m.call("task_land", sessionId=op, milestone="A1", task="1 log format", commit=log_format)
m.call("task_land", sessionId=op, milestone="A1", task="2 snapshots", commit=snapshots, deferred=[{"what": "checksums on snapshot files", "to": "A1:4 checksums"}])
m.call("task_land", sessionId=op, milestone="B1", task="1 shell", commit=shell)

def ran(milestone, task, kind, minute, exit_code, **summary):
    m.call("evidence_record", sessionId=op, milestone=milestone, task=task, kind=kind, command=["cargo", "test", "-p", "store"], cwd=str(REPO),
           started=f"2026-03-02T10:{minute:02d}:00Z", seconds=12, exit=exit_code, summary=summary)
ran("A1", "1 log format", "red", 1, 101, passed=38, failed=3)
ran("A1", "1 log format", "green", 9, 0, passed=41, failed=0)
ran("A1", "1 log format", "clippy", 12, 0, warnings=0)
ran("A1", "2 snapshots", "red", 20, 101, passed=41, failed=7)
ran("A1", "2 snapshots", "green", 31, 0, passed=57, failed=0)
ran("B1", "1 shell", "green", 40, 0, passed=12, failed=0)

m.call("context_put", sessionId=op, kind="rule", title="Never block the scheduler's thread", text="A job that waits on disk or the network runs on the worker pool.", paths=["crates/engine"], section="working", source="the operator, 2026-03-01")
m.call("rulebook_adopt", sessionId=op)
m.call("rule_tailor", sessionId=op, id="rule-2", source="the operator, 2026-03-03")
m.call("rule_tailor", sessionId=op, id="rule-12", source="the operator, 2026-03-03", text="Every test sits in its crate's tests folder and runs with cargo test --locked; write it first and see it fail.")
m.call("context_retire", sessionId=op, id="rule-4", why="Lumen holds no credentials.")
m.call("context_put", sessionId=op, kind="area", title="the store", text="The log, the snapshots and recovery. Entry point: crates/store/src/lib.rs.", paths=["crates/store"])
m.call("context_put", sessionId=op, kind="area", title="the engine", text="The scheduler and its queue. Entry point: crates/engine/src/lib.rs.", paths=["crates/engine"])
m.call("context_put", sessionId=data, kind="howto", title="run the store's tests", text="cargo test -p store --locked", paths=["crates/store"], tags=["tests"])
m.call("context_put", sessionId=data, kind="finding", title="fsync is slow on tmpfs", text="The log's tests take minutes on tmpfs.", paths=["crates/store/src/wal.rs"], tags=["tests", "log"])
m.call("context_put", sessionId=data, kind="finding", title="fsync on tmpfs is a no-op", text="The log's tests are fast on tmpfs; the slow runs came from a debug build.", paths=["crates/store/src/wal.rs"], tags=["tests", "log"], replaces="finding-1")
m.call("context_put", sessionId=data, kind="convention", title="Offsets are u64", text="A position in the log is a u64 byte offset, never a record count.", paths=["crates/store"])
m.call("question_add", sessionId=data, group="store", question="Should snapshot files be compressed?", meanwhile="They are written uncompressed.")
m.call("question_add", sessionId=data, group="store", question="How many segments are kept before compaction?", meanwhile="Every segment is kept.")
m.call("question_edit", sessionId=data, id="Q-2", question="How many segments are kept before compaction runs?", why="say when it runs")
m.call("question_add", sessionId=op, group="exports", question="Which export format comes after csv?", meanwhile="Csv only.", number=7)
m.call("handoff_write", sessionId=data, task="3 recovery", lines=["The segment index lives in crates/store/src/index.rs.", "Recovery reads the newest snapshot first, then the log from its position."])
exports = commit("exports/csv.py", "# csv\n", "feat(exports): csv export")
m.call("phase_add", sessionId=op, id="X1", name="exports", goal="Lumen exports a stream as csv.", weight=3, decision="STO-1")
m.call("phase_add", sessionId=op, id="X2", name="imports", goal="Lumen reads csv back in.", weight=2)
m.call("milestone_add", sessionId=op, id="X1a", stage="X1", name="csv export", track="data", weight=1)
m.call("milestone_add", sessionId=op, id="X2a", stage="X2", name="csv import", track="data", weight=1)
m.call("task_plan", sessionId=op, milestone="X1a", track="data", tasks=["1 write csv"])
m.call("task_plan", sessionId=op, milestone="X2a", track="data", tasks=["1 read csv", "2 validate rows"])
m.call("task_land", sessionId=op, milestone="X1a", task="1 write csv", commit=exports)
m.call("phase_close", sessionId=op, phase="X1", summary="Csv export ships.")
m.call("repo_configure", sessionId=op, config={"reviews": {"required": True, "from": "2026-03-01T00:00:00Z"}})
first = m.call("review_record", sessionId=op, milestone="A1", task="1 log format", commit=log_format, reviewer="a second model", verdict="fix", blocking=2, findings={"high": 2}, summary="Two records can share an offset.")["review"]["id"]
m.call("review_record", sessionId=op, milestone="A1", task="1 log format", commit=log_format, reviewer="a second model", verdict="land", blocking=0, summary="Offsets are unique now.", follows=first)
m.call("review_record", sessionId=op, milestone="A1", task="2 snapshots", commit=snapshots, reviewer="a second model", verdict="stop", blocking=1, findings={"high": 1, "low": 3}, summary="A torn write leaves a snapshot that reads as whole.")
m.call("review_record", sessionId=op, milestone="B1", task="1 shell", commit=shell, reviewer="the design lead", verdict="land", blocking=0, summary="Fine as built.")
m.call("review_record", sessionId=op, milestone="X1a", task="1 write csv", commit=exports, reviewer="the operator", verdict="waived", blocking=0, summary="A script, reviewed with the phase.")
m.call("session_close", sessionId=data)
m.call("session_close", sessionId=op)
m.proc.stdin.close(); m.proc.wait(timeout=20)

tally("question", "answer", "1", "Yes: zstd at level 3.")
tally("decision", "add", "STO-1", "--group", "store", "--text", "Snapshots are compressed with zstd at level 3.", "--since", "2026-03-02", "--status", "decided, not built", "--operator")
tally("decision", "add", "ENG-1", "--group", "engine", "--text", "One worker pool serves every queue.", "--since", "2026-03-01", "--status", "built in A2", "--operator")
tally("decision", "add", "ENG-2", "--group", "engine", "--text", "A failed job is retried with exponential backoff, capped at one hour.", "--since", "2026-03-02", "--status", "decided, not built", "--operator")
tally("decision", "add", "WEB-1", "--group", "web", "--text", "The web shell ships with one theme and no extras first.", "--since", "2026-03-02", "--status", "in force", "--operator")
m = Mcp()
op = m.call("session_open", worktree=str(REPO), agent="operator", brief="land")["id"]
m.call("task_land", sessionId=op, milestone="B1", task="1 shell", commit=shell, deferred=[
    {"what": "a dark theme", "parked": {"why": "after the first release", "decision": "WEB-1", "owner": "the design lead"}},
    {"what": "keyboard shortcuts", "parked": {"why": "after the first release", "decision": "WEB-1", "owner": "the design lead"}},
    {"what": "a print view", "parked": {"why": "nobody has asked for it", "owner": "the operator"}}])
m.call("session_close", sessionId=op)
m.proc.stdin.close(); m.proc.wait(timeout=20)
print(f"the evaluation repository is {REPO}")
print(f"serve it with: node {CLI} --repo {REPO} mcp")
