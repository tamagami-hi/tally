import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

const RUN = { milestone: "B2", task: "4 manifest", command: ["npm", "run", "typecheck"], started: "2026-11-20T09:00:00.000Z", seconds: 4, exit: 0 };

describe("a run recorded with a word", () => {
  test("is kept as evidence with the word as its label, with its scope, and listed by the word", async () => {
    const { repo, trees } = await makeTracked();
    const { call } = await connect(repo);
    const data = await opened(call, trees["data"]!);

    const recorded = await call("evidence_record", { sessionId: data, ...RUN, cwd: trees["data"]!, kind: "typecheck", scope: "the core package" });
    const byWord = await call("evidence_list", { milestone: "B2", kind: "typecheck" });
    const byKind = await call("evidence_list", { milestone: "B2", kind: "evidence" });
    const refused = await call("evidence_record", { sessionId: data, ...RUN, cwd: trees["data"]!, kind: "smoke" });

    expect((recorded.structured["record"] as Record<string, unknown>)).toMatchObject({ kind: "evidence", label: "typecheck", scope: "the core package" });
    expect(byWord.structured["matched"]).toBe(1);
    expect(byKind.structured["matched"]).toBe(1);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("typecheck");
    expect(refused.text).toContain("coverage");
  });
});
