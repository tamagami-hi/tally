import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import { serviceCli } from "../src/service-cli.ts";
import type { IO } from "../src/io.ts";
import { activityPath, readActivity } from "../../core/src/records/activity.ts";
import { readDecisions } from "../../core/src/records/decisions.ts";
import { openSession } from "../../core/src/state/sessions.ts";
import type { Config } from "../../core/src/schema/config.ts";
import type { Repo } from "../../core/src/store/records.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

function io(cwd: string): IO & { lines: string[]; errors: string[] } {
  const captured = { lines: [] as string[], errors: [] as string[], out: (line: string) => captured.lines.push(line), err: (line: string) => captured.errors.push(line), cwd, env: {}, columns: 120, isTTY: false };
  return captured;
}

async function keepingLog(records: Partial<Config["records"]> = {}) {
  const tracked = await makeTracked(records);
  const path = join(tracked.root, "docs", "records", "config.json");
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), context: "records" }, null, 2));
  const repo: Repo = { ...tracked.repo, config: { ...tracked.repo.config, context: "records" } };
  return { ...tracked, repo, console: io(tracked.root) };
}

const ADD = ["decision", "add", "ARC-2", "--group", "shop", "--text", "**One cart.**", "--since", "the operator", "--operator"];

const STATE_HINT = "the status names no state, so it is filed as 'other'; give one with --state: 'in force', 'built', 'partly built' or 'decided, not built'";

const events = async (repo: Repo) => (await readActivity(repo)).events.map(({ at: _at, ...event }) => event);

describe("a decision written on the command line", () => {
  test("each verb leaves one event under the session cli, on the main branch, by --by or cli", async () => {
    const { repo, console } = await keepingLog();

    expect(await run([...ADD, "--status", "decided, not built", "--by", "coordinator"], console)).toBe(0);
    expect(await run(["decision", "setStatus", "ARC-2", "--group", "shop", "--status", "Shipped in the spring", "--state", "built"], console)).toBe(0);
    expect(await run(["decision", "replace", "ARC-2", "--group", "shop", "--text", "**Two carts.**", "--since", "the operator", "--status", "in force", "--why", "wider", "--operator"], console)).toBe(0);

    expect(await events(repo)).toEqual([
      { session: "cli", track: "main", agent: "coordinator", verb: "decision_add", target: "shop / ARC-2: decided, not built" },
      { session: "cli", track: "main", agent: "cli", verb: "decision_status", target: "shop / ARC-2: built" },
      { session: "cli", track: "main", agent: "cli", verb: "decision_replace", target: "shop / ARC-2: in force" },
    ]);
  });

  test("the record's own by stays the operator's when --by names who wrote it", async () => {
    const { repo, console } = await keepingLog();

    await run([...ADD, "--status", "in force", "--by", "coordinator"], console);

    expect((await readDecisions(repo)).decisions[0]).toMatchObject({ by: "operator", state: "in force" });
  });

  test("--state is stored as given, and the answer says the state", async () => {
    const { repo, console } = await keepingLog();

    expect(await run([...ADD, "--status", "Agreed with the maintainer", "--state", "decided, not built"], console)).toBe(0);

    expect(console.lines).toEqual(["decision ARC-2 (shop) added: decided, not built"]);
    expect((await readDecisions(repo)).decisions[0]?.state).toBe("decided, not built");
  });

  test("a status that names no state is filed as other, and the answer names --state", async () => {
    const { console } = await keepingLog();

    expect(await run([...ADD, "--status", "Agreed with the maintainer"], console)).toBe(0);
    expect(await run(["decision", "setStatus", "ARC-2", "--group", "shop", "--status", "Still agreed"], console)).toBe(0);

    expect(console.lines).toEqual(["decision ARC-2 (shop) added: other", STATE_HINT, "decision ARC-2 (shop): Still agreed [other]", STATE_HINT]);
  });

  test("a state that is not one of the five is refused, with the five named, and nothing is written", async () => {
    const { repo, console } = await keepingLog();

    expect(await run([...ADD, "--status", "Agreed", "--state", "done"], console)).toBe(2);

    expect(console.errors).toEqual(["--state must be one of 'in force', 'built', 'partly built', 'decided, not built' or 'other', not 'done'"]);
    expect((await readDecisions(repo)).decisions).toEqual([]);
    expect(await events(repo)).toEqual([]);
  });
});

describe("a question written on the command line", () => {
  test("add, answer and edit each leave one event naming the question's id", async () => {
    const { repo, console } = await keepingLog();

    await run(["question", "add", "--group", "store", "--by", "coordinator", "Keep the cache?", "keep it"], console);
    await run(["question", "edit", "Q-1", "--question", "Keep the cache as it is?", "--why", "clearer"], console);
    await run(["question", "answer", "Q-1", "ARC-2"], console);

    expect(await events(repo)).toEqual([
      { session: "cli", track: "main", agent: "coordinator", verb: "question_add", target: "Q-1" },
      { session: "cli", track: "main", agent: "cli", verb: "question_edit", target: "Q-1" },
      { session: "cli", track: "main", agent: "cli", verb: "question_answer", target: "Q-1" },
    ]);
  });
});

describe("the event of a command-line write", () => {
  test("is not written where the repository keeps no log, and the answer is as before", async () => {
    const tracked = await makeTracked();
    const console = io(tracked.root);

    expect(await run([...ADD, "--status", "in force"], console)).toBe(0);

    expect(console.lines).toEqual(["decision ARC-2 (shop) added: in force"]);
    await expect(access(join(tracked.root, "docs", "records", "log"))).rejects.toThrow();
  });

  test("that fails leaves the decision written, says why, and the command succeeds", async () => {
    const { repo, console } = await keepingLog();
    const day = activityPath(repo, new Date().toISOString().slice(0, 10));
    await mkdir(dirname(day), { recursive: true });
    await writeFile(day, "{ not json");

    expect(await run([...ADD, "--status", "in force"], console)).toBe(0);

    expect((await readDecisions(repo)).decisions.map((one) => one.id)).toEqual(["ARC-2"]);
    expect(console.errors).toEqual([expect.stringMatching(/^the activity log was not written: .*not valid JSON/)]);
  });

  test("is committed with the records when they are committed at once and no session is open", async () => {
    const { repo, console } = await keepingLog({ commit: true });

    expect(await run([...ADD, "--status", "in force"], console)).toBe(0);

    expect(await sh(repo.root, ["status", "--porcelain"])).toBe("");
    expect(await events(repo)).toHaveLength(1);
  });

  test("waits on disk, as a session's do, while a session is open", async () => {
    const { repo, root, trees, console } = await keepingLog({ commit: true });
    await openSession(repo, { worktree: trees["data"]!, agent: "claude" });

    expect(await run([...ADD, "--status", "in force"], console)).toBe(0);

    expect(await sh(root, ["status", "--porcelain"])).toBe("?? docs/records/log/");
  });
});

describe("a command-line write the service carries out", () => {
  test("leaves the same event", async () => {
    const { repo, root } = await keepingLog();

    const answer = await serviceCli(run, {})([...ADD, "--status", "in force"], root);

    expect(answer.exit).toBe(0);
    expect(await events(repo)).toEqual([{ session: "cli", track: "main", agent: "cli", verb: "decision_add", target: "shop / ARC-2: in force" }]);
  });
});
