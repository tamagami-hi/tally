import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { endSession } from "../../src/state/end.ts";
import { openSession } from "../../src/state/sessions.ts";
import type { Config } from "../../src/schema/config.ts";
import { makeTracked } from "../support/tracked.ts";
import { sh } from "../support/repo.ts";

async function closing(records: Partial<Config["records"]>, others = 0) {
  const tracked = await makeTracked(records);
  await sh(tracked.root, ["add", "-A", "docs/records"]);
  await sh(tracked.root, ["commit", "-q", "--allow-empty", "-m", "records: settle"]);
  const data = await openSession(tracked.repo, { worktree: tracked.trees["data"]!, agent: "claude" });
  for (let index = 0; index < others; index += 1) await openSession(tracked.repo, { worktree: tracked.trees["engine"]!, agent: `kiro-${index}` });
  await writeFile(join(tracked.repo.recordsDir, "extra.json"), "{}\n");
  return { ...tracked, data };
}

describe("session_close says what happened to the records", () => {
  test("where each record is committed as it is written", async () => {
    const { repo, data } = await closing({ commit: true });

    expect((await endSession(repo, data.id)).records).toBe("records are committed as each is written (one written during a landing's turn goes in when that landing ends)");
  });

  test("where the last session to close commits them, with the hash, or that they wait for it", async () => {
    const last = await closing({ commit: true, batch: true });
    const notLast = await closing({ commit: true, batch: true }, 1);

    const ended = await endSession(last.repo, last.data.id);

    expect(ended.records).toBe(`this was the last session, so the waiting records were committed as ${ended.recordsCommit}`);
    expect((await endSession(notLast.repo, notLast.data.id)).records).toBe("the records wait for the last session to close");
  });

  test("where they wait for the phase to close", async () => {
    const { repo, data } = await closing({ commit: true, batch: true, commitAt: "phase" });

    expect((await endSession(repo, data.id)).records).toBe("1 record file waits for the close of the phase (phase_close), or for records_commit");
  });

  test("where the repository commits them by hand", async () => {
    const { repo, data } = await closing({ commit: false });

    expect((await endSession(repo, data.id)).records).toBe("this repository commits its records by hand (records.commit is false)");
  });
});

describe("session_close in the rest mode with nothing waiting", () => {
  test("says no record was waiting", async () => {
    const tracked = await makeTracked({ commit: true, batch: true });
    await sh(tracked.root, ["add", "-A", "docs/records"]);
    await sh(tracked.root, ["commit", "-q", "--allow-empty", "-m", "records: settle"]);
    const data = await openSession(tracked.repo, { worktree: tracked.trees["data"]!, agent: "claude" });

    expect((await endSession(tracked.repo, data.id)).records).toBe("no record was waiting to be committed");
  });
});
