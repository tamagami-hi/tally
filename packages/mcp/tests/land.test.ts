import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createTallyServer } from "../src/server.ts";
import { edit, landingFixture, type LandingFixture } from "../../core/tests/support/landing.ts";
import { sh } from "../../core/tests/support/repo.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
}

type Call = (name: string, args?: Record<string, unknown>) => Promise<Called>;

async function serving(script = "true"): Promise<LandingFixture & { call: Call; session: string }> {
  const fixture = await landingFixture(script);
  const server = createTallyServer(fixture.repo);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call: Call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  };
  const opened = await call("session_open", { worktree: fixture.tree, agent: "claude" });
  return { ...fixture, call, session: opened.structured["id"] as string };
}

function runScript(command: string): Promise<number> {
  return new Promise((done) => {
    execFile("sh", ["-c", command], (error) => done(error === null ? 0 : typeof error.code === "number" ? error.code : 1));
  });
}

describe("landing through the queue", () => {
  test("land_start answers the turn and the script to run, and land_wait answers the landing once the script has run", async () => {
    const s = await serving();
    await edit(s.tree, "src/a.rs");

    const started = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], message: "feat(data): through the queue\n" });

    expect(started.isError).toBe(false);
    expect(started.structured["state"]).toBe("turn");
    expect(started.structured["run"]).toBe(`sh ${join(s.tree, ".temp/tally/landing", `${String(started.structured["ticket"])}-1.sh`)}`);
    expect(await runScript(started.structured["run"] as string)).toBe(0);
    const landed = await s.call("land_wait", { sessionId: s.session, ticket: started.structured["ticket"], after: "turn", seconds: 5 });
    expect(landed.structured["state"]).toBe("landed");
    expect(await sh(s.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): through the queue");
  });

  test("land_start takes the message from a file in the worktree", async () => {
    const s = await serving();
    await edit(s.tree, "src/a.rs");
    await writeFile(join(s.tree, ".temp", "message.txt"), "feat(data): from a file\n");

    const started = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], messageFile: ".temp/message.txt" });

    expect(started.structured["state"]).toBe("turn");
    expect(await sh(s.tree, ["log", "-1", "--format=%s"])).toBe("feat(data): from a file");
  });

  test("land_start refuses a message file outside the worktree", async () => {
    const s = await serving();
    await edit(s.tree, "src/a.rs");

    const outside = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], messageFile: "/etc/hostname" });
    const climbing = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], messageFile: "../../../README.md" });

    expect(outside.isError).toBe(true);
    expect(outside.text).toBe("the message file must be inside the worktree: /etc/hostname");
    expect(climbing.isError).toBe(true);
  });

  test("land_wait answers a failure with the reason", async () => {
    const s = await serving("exit 4");
    await edit(s.tree, "src/a.rs");
    const started = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], message: "feat(data): will fail\n" });
    await runScript(started.structured["run"] as string);

    const failed = await s.call("land_wait", { sessionId: s.session, ticket: started.structured["ticket"], after: "turn", seconds: 5 });

    expect(failed.structured["state"]).toBe("failed");
    expect(failed.structured["problem"]).toContain("failed its checks (exit 4)");
  });

  test("land_wait comes back after its seconds when nothing changed", async () => {
    const s = await serving();
    await edit(s.tree, "src/a.rs");
    const started = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], message: "feat(data): slow\n" });
    const before = Date.now();

    const still = await s.call("land_wait", { sessionId: s.session, ticket: started.structured["ticket"], after: "turn", seconds: 1 });

    expect(still.structured["state"]).toBe("turn");
    expect(Date.now() - before).toBeGreaterThanOrEqual(900);
  });

  test("land_wait is refused for another repository's or an unknown ticket", async () => {
    const s = await serving();

    const refused = await s.call("land_wait", { sessionId: s.session, ticket: "nope", seconds: 1 });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("no ticket nope");
  });

  test("land_cancel takes a waiting ticket out of the queue", async () => {
    const s = await serving();
    await edit(s.tree, "src/a.rs");
    const first = await s.call("land_start", { sessionId: s.session, files: ["src/a.rs"], message: "feat(data): one\n" });

    const refused = await s.call("land_cancel", { sessionId: s.session, ticket: first.structured["ticket"] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("only a ticket that has not had its turn can be cancelled");
  });
});
