import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  test("still lists the runs kept for a milestone the ledger no longer has", async () => {
    const { repo, trees } = await makeTracked();
    const { call } = await connect(repo);
    const data = await opened(call, trees["data"]!, "claude");
    await call("evidence_record", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["cargo", "test"], cwd: trees["data"], started: "2026-11-04T09:00:00.000Z", seconds: 1, exit: 0, summary: { passed: 1 } });
    const kept = JSON.parse(await readFile(join(repo.recordsDir, "evidence", "B2.json"), "utf8")) as { milestone: string; records: { milestone: string }[] };
    await writeFile(join(repo.recordsDir, "evidence", "OLD1.json"), JSON.stringify({ ...kept, milestone: "OLD1", records: kept.records.map((record) => ({ ...record, milestone: "OLD1" })) }));

    const listed = await call("evidence_list", { milestone: "OLD1" });

    expect(listed.isError).toBe(false);
    expect(listed.structured["matched"]).toBe(1);
  });

  test("refuses a milestone the ledger does not have, and names the ones it has", async () => {
    const call = await recorded(0);

    const missing = await call("evidence_list", { milestone: "ZZ9" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("no milestone 'ZZ9'");
    expect(missing.text).toContain("B2");
  });
});

describe("a run record's head and dirty", () => {
  test("are answered with the record, and fields keeps them", async () => {
    const { repo, trees } = await makeTracked();
    const { call } = await connect(repo);
    const data = await opened(call, trees["data"]!, "claude");
    await writeFile(join(trees["data"]!, "new.rs"), "fn main() {}\n");
    const ran = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["true"] });
    const head = (ran.structured["record"] as { head?: string }).head;

    const listed = await call("evidence_list", { milestone: "B2", fields: ["head", "dirty"] });

    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(listed.structured["records"]).toEqual([{ head, dirty: true }]);
  });
});
