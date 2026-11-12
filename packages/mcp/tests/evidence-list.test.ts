import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

async function recorded(count: number) {
  const { repo, trees } = await makeTracked();
  const { call } = await connect(repo);
  const data = await opened(call, trees["data"]!, "claude");
  for (let n = 0; n < count; n += 1) {
    const started = new Date(Date.UTC(2026, 10, 4, 9, n)).toISOString();
    const done = await call("evidence_record", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["cargo", "test"], cwd: trees["data"], started, seconds: 1, exit: 0, summary: { passed: n } });
    if (done.isError) throw new Error(done.text);
  }
  return call;
}

describe("listing run records", () => {
  test("answers the 20 started last unless told, and how many there are", async () => {
    const call = await recorded(23);

    const listed = await call("evidence_list", { milestone: "B2" });
    const records = listed.structured["records"] as { summary: { passed: number } }[];

    expect(records).toHaveLength(20);
    expect(records.at(-1)?.summary.passed).toBe(22);
    expect(listed.structured["matched"]).toBe(23);
  });

  test("answers as many as asked for", async () => {
    const call = await recorded(23);

    expect((await call("evidence_list", { milestone: "B2", limit: 23 })).structured["records"]).toHaveLength(23);
  });

  test("refuses a milestone the ledger does not have, and names the ones it has", async () => {
    const call = await recorded(0);

    const missing = await call("evidence_list", { milestone: "ZZ9" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("no milestone 'ZZ9'");
    expect(missing.text).toContain("B2");
  });
});
