import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { landedAt, requiring } from "../../core/tests/support/reviews.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const tracked = await makeTracked();
  const repo = requiring(tracked.repo, true);
  await landedAt(repo, "done", "2026-11-14T10:00:00.000Z");
  const { call, client } = await connect(repo);
  return { ...tracked, call, client, head: await sh(tracked.root, ["rev-parse", "HEAD"]), data: await opened(call, tracked.trees["data"]!, "claude") };
}

const REVIEW = { milestone: "B2", task: "done", reviewer: "a second model", verdict: "land", blocking: 0, summary: "nothing blocks" };

describe("a text longer than its limit", () => {
  test("is refused in tally's words: the parameter, its limit and the length given", async () => {
    const { call, data, head } = await serving();

    const refused = await call("review_record", { sessionId: data, ...REVIEW, commit: head, summary: "x".repeat(1_001) });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("summary holds at most 1000 characters; this one has 1001");
    expect(refused.text).not.toContain("Too big");
  });

  test("is refused the same way by another tool, nested in a list", async () => {
    const { call, data } = await serving();

    const why = await call("question_edit", { sessionId: data, id: "Q-1", why: "y".repeat(201) });
    const parked = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: "HEAD", deferred: [{ what: "the rest", parked: { why: "w".repeat(201) } }] });

    expect(why.text).toContain("why holds at most 200 characters; this one has 201");
    expect(parked.text).toContain("why holds at most 200 characters; this one has 201");
  });

  test("is refused the same way as the name of a review's finding", async () => {
    const { call, data, head } = await serving();

    const refused = await call("review_record", { sessionId: data, ...REVIEW, commit: head, findings: { ["k".repeat(41)]: 1 } });

    expect(refused.text).toContain("a finding's name holds at most 40 characters; this one has 41");
  });

  test("keeps each limit in the listed input schema", async () => {
    const { client } = await serving();
    const tools = (await client.listTools()).tools;
    const property = (tool: string, name: string): { maxLength?: number } | undefined => (tools.find((one) => one.name === tool)?.inputSchema.properties?.[name] as { maxLength?: number } | undefined);

    expect(property("review_record", "summary")?.maxLength).toBe(1_000);
    expect(property("review_record", "reviewer")?.maxLength).toBe(120);
    expect(property("question_add", "question")?.maxLength).toBe(2_000);
    expect(property("rule_tailor", "text")?.maxLength).toBe(2_000);
  });
});

describe("a file not found from a relative path", () => {
  test("is refused with the folder it was read against, and the absolute folder that is accepted", async () => {
    const { call, data, head, root, trees } = await serving();

    const refused = await call("review_record", { sessionId: data, ...REVIEW, commit: head, report: ".temp/reviews/r1.md" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`the report does not exist: ${join(trees["data"]!, ".temp/reviews/r1.md")}; a relative path is read against the session's worktree, ${trees["data"]!}; an absolute path under ${join(root, ".temp")} is accepted too`);
  });

  test("is accepted from a lane session when it is an absolute path under the repository's .temp/", async () => {
    const { call, data, head, root } = await serving();
    await mkdir(join(root, ".temp", "reviews"), { recursive: true });
    await writeFile(join(root, ".temp", "reviews", "r1.md"), "# review\n");

    const recorded = await call("review_record", { sessionId: data, ...REVIEW, commit: head, report: join(root, ".temp", "reviews", "r1.md") });

    expect(recorded.isError).toBe(false);
  });

  test("names the log folder for evidence_record", async () => {
    const { call, data, root, trees } = await serving();

    const refused = await call("evidence_record", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["true"], cwd: ".", started: "", seconds: 0, exit: 0, logPath: "green.log" });

    expect(refused.text).toBe(`the log does not exist: ${join(trees["data"]!, "green.log")}; a relative path is read against the session's worktree, ${trees["data"]!}; an absolute path under ${join(root, ".temp/tally/logs")} is accepted too`);
  });

  test("is refused as before when the path given is absolute", async () => {
    const { call, data, head, root } = await serving();

    const refused = await call("review_record", { sessionId: data, ...REVIEW, commit: head, report: join(root, ".temp", "nowhere.md") });

    expect(refused.text).toBe(`the report does not exist: ${join(root, ".temp", "nowhere.md")}`);
  });
});
