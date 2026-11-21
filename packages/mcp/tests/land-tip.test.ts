import { execFile } from "node:child_process";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "vitest";
import { Records } from "../../core/src/store/records.ts";
import { commitOn, landingFixture } from "../../core/tests/support/landing.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { createTallyServer } from "../src/server.ts";

async function serving() {
  const fixture = await landingFixture("true");
  await new Records(fixture.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
  await sh(fixture.root, ["add", "-A"]);
  await sh(fixture.root, ["commit", "-q", "-m", "records: plan"]);
  const server = createTallyServer(fixture.repo);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  };
  const session = (await call("session_open", { worktree: fixture.tree, agent: "claude" })).structured["id"] as string;
  return { ...fixture, call, session };
}

const run = (command: string): Promise<number> => new Promise((done) => execFile("sh", ["-c", command], (error) => done(error === null ? 0 : 1)));

describe("a landing that checks its tip only, through the tools", () => {
  test("land_start takes check tip and says so, and ledger_check counts the tasks so landed", async () => {
    const s = await serving();
    await commitOn(s.tree, "src/one.rs", "feat: one");
    await commitOn(s.tree, "src/two.rs", "feat: two");

    const started = await s.call("land_start", { sessionId: s.session, milestone: "A1", task: "t1", check: "tip" });
    expect(started.structured).toMatchObject({ state: "turn", check: "tip" });
    expect(await run(started.structured["run"] as string)).toBe(0);
    await s.call("land_wait", { sessionId: s.session, ticket: started.structured["ticket"], after: "turn", seconds: 5 });

    expect((await s.call("ledger_check", {})).structured["tipOnly"]).toBe(1);
  });
});
