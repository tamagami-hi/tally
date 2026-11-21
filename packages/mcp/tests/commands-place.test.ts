import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listEvidence } from "../../core/src/records/evidence.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";
import { withDefaults } from "./support/hints.ts";

async function serving(place: "service" | "agent") {
  const tracked = await makeTracked();
  const { call, client } = await connect(tracked.repo, place);
  return { ...tracked, call, client, data: await opened(call, tracked.trees["data"]!, "claude") };
}

const toolNamed = async (client: Awaited<ReturnType<typeof serving>>["client"], name: string) => (await client.listTools()).tools.find((tool) => tool.name === name);

describe("a service whose agents run the project's commands", () => {
  test("answers evidence_run with the runner line, runs nothing and records nothing", async () => {
    const { call, data, repo, trees } = await serving("agent");

    const answer = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "sweep", command: ["tools/run.sh", "npm test"] });

    expect(answer.isError).toBe(false);
    expect(answer.structured).toMatchObject({ ran: false, run: `cd ${trees["data"]!} && sh .temp/tally/run sweep --task 'B2:4 manifest' -- tools/run.sh 'npm test'` });
    expect(answer.structured["why"]).toContain("run the line in your own shell");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });

  test("writes nothing to the activity log for an evidence_run that ran nothing", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(tracked.repo), "agent");
    const data = await opened(call, tracked.trees["data"]!, "claude");
    const logged = async (): Promise<string[]> => readdir(join(tracked.repo.recordsDir, "log")).catch(() => []);
    const before = await logged();

    await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "sweep", command: ["true"] });

    expect((await call("activity_get", { sessionId: data })).structured).not.toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ tool: "evidence_run" })]) });
    expect(await logged()).toEqual(before);
  });

  test("lists evidence_run as a read that reaches nothing outside, and says the agent runs the command", async () => {
    const { client } = await serving("agent");

    const tool = await toolNamed(client, "evidence_run");

    expect(tool?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tool?.description).toContain("runs no command");
    expect(tool?.description).toContain("your own shell");
  });

  test("does not list land_run, which could only refuse there, and a call to it changes nothing", async () => {
    const { call, client, data, repo } = await serving("agent");

    const refused = await call("land_run", { sessionId: data, files: [] });

    expect(await toolNamed(client, "land_run")).toBeUndefined();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("land_start");
    expect(refused).toMatchObject({ isError: true, code: -32602, text: "Tool land_run not found" });
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });
});

describe("what a service that runs no command says of itself", () => {
  test("counts in session_open's server the tools it lists, which leave out land_run", async () => {
    const { call, client, trees } = await serving("agent");

    const opened = await call("session_open", { worktree: trees["engine"]!, agent: "kiro" });
    const listed = (await client.listTools()).tools.map((tool) => tool.name);

    expect((opened.structured["server"] as { tools: number }).tools).toBe(listed.length);
    expect((opened.structured["server"] as { newest: string[] }).newest.every((name) => listed.includes(name))).toBe(true);
  });
});

describe("a service that runs the project's commands", () => {
  test("keeps evidence_run's hints and runs the command", async () => {
    const { call, client, data, repo } = await serving("service");

    const answer = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["true"] });

    expect(answer.structured["recorded"]).toBe(true);
    expect(await listEvidence(repo, "B2")).toHaveLength(1);
    expect(withDefaults((await toolNamed(client, "evidence_run"))?.annotations)).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
  });

  test("answers a run that exited 127 with recorded false and the runner line", async () => {
    const { call, data, repo } = await serving("service");

    const answer = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "sweep", command: ["sh", "-c", "exit 127"] });

    expect(answer.structured["recorded"]).toBe(false);
    expect(answer.structured["problem"]).toContain("exit 127 means the shell did not find a program");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });
});
