import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

const CHECK = { milestone: "B2", task: "4 manifest", who: "the operator, on a phone", result: "pass", steps: ["open the app", "read the manifest"] };

async function builder() {
  const { repo, trees } = await makeTracked();
  const { call } = await connect(repo);
  const data = await opened(call, trees["data"]!, "claude");
  return { repo, call, data };
}

describe("a check made by hand", () => {
  test("is recorded with its attachment, counted by evidence_list, and listed with kind manual", async () => {
    const { repo, call, data } = await builder();
    await mkdir(join(repo.root, ".temp", "shots"), { recursive: true });
    await writeFile(join(repo.root, ".temp", "shots", "one.png"), "a screenshot\n");

    const made = await call("evidence_manual", { sessionId: data, ...CHECK, device: "a phone", attachments: [join(repo.root, ".temp", "shots", "one.png")] });
    await call("evidence_manual", { sessionId: data, ...CHECK, result: "fail" });

    expect(made.isError).toBe(false);
    expect(made.structured["check"]).toMatchObject({ id: "manual-1", result: "pass", device: "a phone", attachments: [{ bytes: 13 }] });
    expect((await call("evidence_list", { milestone: "B2" })).structured).toMatchObject({ records: [], matched: 0, manual: 2 });
    const listed = await call("evidence_list", { milestone: "B2", task: "4 manifest", kind: "manual", fields: ["id", "result"] });
    expect(listed.structured).toEqual({ checks: [{ id: "manual-1", result: "pass" }, { id: "manual-2", result: "fail" }], matched: 2 });
  });

  test("answers no manual count where none was made", async () => {
    const { call } = await builder();

    expect((await call("evidence_list", { milestone: "B2" })).structured).not.toHaveProperty("manual");
  });

  test("refuses an attachment outside the repository's .temp/, and records nothing", async () => {
    const { repo, call, data } = await builder();

    const refused = await call("evidence_manual", { sessionId: data, ...CHECK, attachments: [join(repo.root, "README.md")] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("an attachment must be a file under the repository's .temp/");
    expect((await call("evidence_list", { milestone: "B2", kind: "manual" })).structured).toEqual({ checks: [], matched: 0 });
  });
});
