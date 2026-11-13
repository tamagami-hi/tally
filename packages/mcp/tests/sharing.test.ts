import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createTallyServer } from "../src/server.ts";
import { commitOn, edit } from "../../core/tests/support/landing.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
}

async function two() {
  const tracked = await makeTracked();
  const server = createTallyServer(tracked.repo);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Called> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  };
  const open = async (track: string, agent: string): Promise<string> => (await call("session_open", { worktree: tracked.trees[track] ?? "", agent })).structured["id"] as string;
  return { ...tracked, call, data: await open("data", "claude"), engine: await open("engine", "kiro") };
}

describe("notes between agents", () => {
  test("a note for a track arrives in that track's next answer, once, and the text says so too", async () => {
    const s = await two();

    const posted = await s.call("note_post", { sessionId: s.engine, to: ["data"], kind: "heads-up", text: "The reader moved to src/read.rs." });
    const next = await s.call("task_claim", { sessionId: s.data, milestone: "B2", task: "4 manifest" });
    const after = await s.call("session_list", { sessionId: s.data });

    expect(posted.structured["id"]).toBe("note-1");
    expect(next.structured["inbox"]).toEqual([expect.objectContaining({ kind: "note", from: "engine" })]);
    expect(next.text).toContain("inbox:\n- heads-up from engine (kiro): The reader moved to src/read.rs.");
    expect(after.structured["inbox"]).toBeUndefined();
  });

  test("a note is not delivered to its own writer, nor to a track it is not for", async () => {
    const s = await two();

    const posted = await s.call("note_post", { sessionId: s.engine, to: ["main"], kind: "request", text: "For the operator." });
    const data = await s.call("session_list", { sessionId: s.data });

    expect(posted.structured["inbox"]).toBeUndefined();
    expect(data.structured["inbox"]).toBeUndefined();
  });

  test("replies, closing and listing go through the tools", async () => {
    const s = await two();
    await s.call("note_post", { sessionId: s.data, to: ["engine"], kind: "request", text: "Expose the reader?" });

    const replied = await s.call("note_reply", { sessionId: s.engine, id: "note-1", text: "Yes." });
    const listed = await s.call("note_list", { sessionId: s.engine });
    await s.call("note_done", { sessionId: s.engine, id: "note-1" });
    const open = await s.call("note_list", { sessionId: s.engine });
    const all = await s.call("note_list", { sessionId: s.engine, state: "all" });

    expect((replied.structured["replies"] as unknown[]).length).toBe(1);
    expect((listed.structured["notes"] as { id: string }[]).map((note) => note.id)).toEqual(["note-1"]);
    expect(open.structured["notes"]).toEqual([]);
    expect((all.structured["notes"] as unknown[]).length).toBe(1);
  });

  test("inbox_get reads again what was delivered, without taking it", async () => {
    const s = await two();
    const before = new Date(Date.now() - 1000).toISOString();
    await s.call("note_post", { sessionId: s.engine, to: "all", kind: "finding", text: "Worth knowing." });
    await s.call("session_list", { sessionId: s.data });

    const again = await s.call("inbox_get", { sessionId: s.data, since: before });

    expect((again.structured["items"] as { kind: string }[]).map((item) => item.kind)).toEqual(["note"]);
  });
});

describe("an answer when what is shared cannot be read", () => {
  test("is still the tool's own answer", async () => {
    const s = await two();
    await s.call("note_post", { sessionId: s.engine, to: ["data"], kind: "finding", text: "The index is rebuilt on open." });
    await writeFile(join(s.root, "docs/records/context/notes.json"), "{ not json");

    const listed = await s.call("session_list", { sessionId: s.data });

    expect(listed.isError).toBe(false);
    expect((listed.structured["sessions"] as unknown[]).length).toBe(2);
    expect(listed.structured["inbox"]).toBeUndefined();
  });

  test("inbox_get reads from the session's opening when no time is given", async () => {
    const s = await two();
    await s.call("note_post", { sessionId: s.engine, to: ["data"], kind: "finding", text: "The index is rebuilt on open." });
    await s.call("session_list", { sessionId: s.data });

    const again = await s.call("inbox_get", { sessionId: s.data });

    expect(again.structured["items"]).toEqual([expect.objectContaining({ kind: "note", from: "engine" })]);
  });
});

describe("a commit on main that no record names", () => {
  test("is told to the session on main in its very first answer, with how to record it", async () => {
    const tracked = await makeTracked();
    const hash = await commitOn(tracked.root, "docs/plan.md", "docs(plan): by hand");
    const server = createTallyServer(tracked.repo);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);

    const opened = await client.callTool({ name: "session_open", arguments: { worktree: tracked.root, agent: "operator" } });
    const inbox = ((opened.structuredContent ?? {}) as { inbox?: { kind: string; text: string }[] }).inbox ?? [];

    expect(inbox.filter((item) => item.kind === "ledger").map((item) => item.text)).toEqual([expect.stringContaining(`${hash.slice(0, 7)} docs(plan): by hand. Record it with task_land`)]);
  });
});

describe("overlap warnings", () => {
  test("a claim says which other tracks have changed the same files", async () => {
    const s = await two();
    await commitOn(s.trees["engine"] ?? "", "src/shared.rs", "feat: engine's side");
    await edit(s.trees["data"] ?? "", "src/shared.rs", "data's side\n");

    const claimed = await s.call("task_claim", { sessionId: s.data, milestone: "B2", task: "4 manifest" });

    expect(claimed.structured["overlaps"]).toEqual([{ file: "src/shared.rs", with: ["engine"] }]);
    expect(claimed.text).toContain("overlaps:\n- src/shared.rs is also changed by engine");
  });

  test("opening a session says so too, and an answer with nothing shared says nothing", async () => {
    const tracked = await makeTracked();
    await commitOn(tracked.trees["engine"] ?? "", "src/shared.rs", "feat: engine's side");
    await edit(tracked.trees["data"] ?? "", "src/shared.rs", "data's side\n");
    const server = createTallyServer(tracked.repo);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);

    const opened = (await client.callTool({ name: "session_open", arguments: { worktree: tracked.trees["data"] ?? "", agent: "claude" } })).structuredContent as Record<string, unknown>;
    const operator = (await client.callTool({ name: "session_open", arguments: { worktree: tracked.root, agent: "operator" } })).structuredContent as Record<string, unknown>;

    expect(opened["overlaps"]).toEqual([{ file: "src/shared.rs", with: ["engine"] }]);
    expect(operator["overlaps"]).toBeUndefined();
  });
});
