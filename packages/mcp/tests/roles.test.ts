import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Repos } from "../../core/src/repos/repos.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { closeSession } from "../../core/src/state/sessions.ts";
import { Usage } from "../../core/src/usage/counts.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { createTallyServer } from "../src/server.ts";
import { manyRepos } from "../src/source.ts";
import { DECORATORS } from "../src/decorate.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

const BUILDER = ["session_open", "session_close", "task_claim", "task_release", "task_wait", "task_unwait", "evidence_record", "evidence_manual", "evidence_list", "land_start", "land_wait", "land_cancel", "handoff_read", "handoff_write", "note_post", "note_reply", "note_done", "inbox_get", "question_add", "question_list", "decision_list", "context_get", "context_put", "covering", "board_get"];
const REVIEWER = ["session_open", "session_close", "review_record", "review_list", "evidence_list", "decision_list", "context_get", "context_put", "covering", "rulebook_get", "question_add", "handoff_read", "note_post", "inbox_get", "board_get"];
const ROLES = { builder: { tools: BUILDER, most: 30_000 }, reviewer: { tools: REVIEWER, most: 22_000 } } as const;

async function made() {
  const fixture = await cycling();
  return { ...fixture, repo: keepingContextAsRecords(fixture.repo) };
}

async function service() {
  const fixture = await cycling();
  await closeSession(fixture.repo, fixture.operator.id);
  const home = await tmpDir("tally-home-");
  await addRepo(home, { root: fixture.root, name: "alpha" });
  return { ...fixture, source: manyRepos(new Repos(home)) };
}

describe.each(Object.entries(ROLES))("the %s's address", (role, { tools, most }) => {
  test("lists exactly its set, within its limit, and the plain address lists every tool", async () => {
    const { repo } = await made();
    const { client } = await connect(repo, undefined, role as "builder" | "reviewer");
    const listed = (await client.listTools()).tools;
    const whole = (await (await connect(repo)).client.listTools()).tools;

    expect(listed.map((tool) => tool.name).sort()).toEqual([...tools].sort());
    expect(JSON.stringify(listed).length).toBeLessThan(most);
    expect(whole.length).toBeGreaterThan(listed.length);
    expect(whole.map((tool) => tool.name)).toEqual(expect.arrayContaining([...tools]));
  });

  test("refuses a tool outside its set, for one repository and for the service", async () => {
    const one = await made();
    const many = await service();

    for (const from of [one.repo, many.source]) {
      const { call } = await connect(from, undefined, role as "builder" | "reviewer");
      const refused = await call("cycle_close", { sessionId: "s-none", summary: "x", said: "y" });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("Tool cycle_close not found");
    }
  });

  test("opens a track session with its work order, and carries the role's protocol as its instructions", async () => {
    const { repo, root } = await made();
    const { client, call } = await connect(repo, undefined, role as "builder" | "reviewer");

    const brief = (await call("session_open", { worktree: join(root, ".temp/worktrees/eng"), agent: "kiro" })).structured["brief"] as { level: string };
    const instructions = client.getInstructions() ?? "";

    expect(brief.level).toBe("order");
    expect(instructions.length).toBeGreaterThan(200);
    expect(instructions.length).toBeLessThanOrEqual(1_500);
    expect(instructions).toContain("session_open");
  });
});

describe("the roles' definitions", () => {
  test("repo_list answers each role's address, tools and the names a client's allow-list takes", async () => {
    const { repo } = await made();
    const { call } = await connect(repo);

    const roles = (await call("repo_list")).structured["roles"] as Record<string, { address: string; tools: string[]; allowedTools: string[] }>;

    expect(Object.keys(roles)).toEqual(["builder", "reviewer"]);
    expect(roles["builder"]).toMatchObject({ address: "/mcp/builder", tools: BUILDER });
    expect(roles["reviewer"]?.allowedTools).toEqual(REVIEWER.map((tool) => `mcp__tally__${tool}`));
  });

  test("a call at a role's address is counted with its address", async () => {
    const { repo } = await made();
    const usage = await Usage.open(join(await tmpDir("tally-usage-"), "usage.json"), "0.8.0");
    const server = createTallyServer(repo, DECORATORS, undefined, usage, "reviewer");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);

    await client.callTool({ name: "board_get", arguments: {} });

    expect(usage.snapshot().tools["board_get"]?.via).toEqual({ reviewer: 1 });
  });
});
