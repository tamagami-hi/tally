import { describe, expect, test } from "vitest";
import { sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const COVERED = "the ledger covers every commit on main";

describe("ledger_check and a commit that changes only the records", () => {
  test("in the phase mode, a session's close event swept up by someone else's commit leaves the check clean, and shown", async () => {
    const tracked = await makeTracked({ commit: true, batch: true, commitAt: "phase" });
    const { call } = await connect(keepingContextAsRecords(tracked.repo));
    await sh(tracked.root, ["add", "-A"]);
    await sh(tracked.root, ["commit", "-q", "-m", "records: the ledger"]);
    const session = await opened(call, tracked.trees["data"]!, "claude");
    await call("task_plan", { sessionId: session, milestone: "B2", tasks: ["6 index"] });
    await call("session_close", { sessionId: session });
    await sh(tracked.root, ["add", "-A"]);
    await sh(tracked.root, ["commit", "-q", "-m", "chore(main): update working tree"]);
    const swept = await sh(tracked.root, ["rev-parse", "--short=7", "HEAD"]);

    const check = await call("ledger_check");

    expect(check.structured).toMatchObject({ missing: [], covered: true, passed: { total: 1, shown: [{ commit: swept, subject: "chore(main): update working tree", why: "records only" }] } });
    expect(check.text).toBe(`${COVERED}\nthe check passes over 1 commit on main that changes only files under docs/records`);
  });

  test("passed is there and empty when nothing was passed over", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(tracked.repo);

    const check = await call("ledger_check");

    expect(check.structured["passed"]).toStrictEqual({ total: 0, shown: [] });
    expect(check.text).toBe(COVERED);
  });
});
