import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER } from "../../core/src/land/runner.ts";
import { listEvidence } from "../../core/src/records/evidence.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

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
    expect(answer.structured).toMatchObject({ ran: false, run: `sh ${join(trees["data"]!, RUNNER)} sweep --task 'B2:4 manifest' -- tools/run.sh 'npm test'` });
    expect(answer.structured["why"]).toContain("run the line in your own shell");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });

  test("lists evidence_run as a read that reaches nothing outside, and says the agent runs the command", async () => {
    const { client } = await serving("agent");

    const tool = await toolNamed(client, "evidence_run");

    expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tool?.description).toContain("runs no command");
    expect(tool?.description).toContain("your own shell");
  });

  test("refuses land_run and names land_start, and its description says so", async () => {
    const { call, client, data } = await serving("agent");

    const refused = await call("land_run", { sessionId: data });

    expect(refused).toMatchObject({ isError: true, text: "this service does not run commands; land with land_start, which commits, rebases and hands you a script to run in your own shell, then land_wait" });
    expect((await toolNamed(client, "land_run"))?.description).toContain("land_start");
  });
});

describe("a service that runs the project's commands", () => {
  test("keeps evidence_run's hints and runs the command", async () => {
    const { call, client, data, repo } = await serving("service");

    const answer = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["true"] });

    expect(answer.structured["recorded"]).toBe(true);
    expect(await listEvidence(repo, "B2")).toHaveLength(1);
    expect((await toolNamed(client, "evidence_run"))?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
  });

  test("answers a run that exited 127 with recorded false and the runner line", async () => {
    const { call, data, repo } = await serving("service");

    const answer = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "sweep", command: ["sh", "-c", "exit 127"] });

    expect(answer.structured["recorded"]).toBe(false);
    expect(answer.structured["problem"]).toContain("exit 127 means the shell did not find a program");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });
});
