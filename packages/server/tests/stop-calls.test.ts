import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { startService } from "../src/serve.ts";
import { BARE_HEADERS } from "./support/wire.ts";
import { REVISIONS, type Revision } from "./support/revisions.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { notesPath, readNotes } from "../../core/src/records/notes.ts";
import { holding } from "../../core/tests/support/pending.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { newerInit, until } from "../../mcp/tests/support/newer.ts";

const entered = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@tally/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/mcp")>();
  return {
    ...actual,
    mcpEndpoint: (...args: Parameters<typeof actual.mcpEndpoint>) => {
      const real = actual.mcpEndpoint(...args);
      return { ...real, fetch: (request: Request) => ((entered.calls += 1), real.fetch(request)) };
    },
  };
});

const SHORT_GRACE_MS = 400;
const MARGIN_MS = 2000;
const RELEASED_AFTER_MS = 300;
const TEXT = "written while the service stops";

afterEach(() => {
  vi.restoreAllMocks();
});

function init(revision: Revision, name: string, args: Record<string, unknown>): RequestInit {
  if (revision === "2026-07-28") return newerInit("tools/call", { name, arguments: args });
  return { method: "POST", headers: BARE_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) };
}

async function serving(stopGraceMs?: number) {
  entered.calls = 0;
  const home = await tmpDir("tally-home-");
  const tracked = await makeTracked();
  await addRepo(home, { root: tracked.root, name: "alpha" });
  const running = await startService({ home, workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: tracked.root, intervalMs: 50, ...(stopGraceMs === undefined ? {} : { stopGraceMs }) });
  const call = async (revision: Revision, name: string, args: Record<string, unknown>): Promise<Response> => fetch(new URL("mcp", running.url), init(revision, name, args));
  const operator = async (revision: Revision): Promise<string> => ((await (await call(revision, "session_open", { worktree: tracked.root, agent: "operator" })).json()) as { result: { structuredContent: { id: string } } }).result.structuredContent.id;
  return { running, tracked, call, operator };
}

describe.each(REVISIONS)("a call in flight when the service stops, on %s", (revision) => {
  test("is answered whole, and what it wrote is there once", async () => {
    const { running, tracked, call, operator } = await serving();
    const session = await operator(revision);
    const held = await holding(notesPath(tracked.repo));
    const before = entered.calls;
    const posting = call(revision, "note_post", { sessionId: session, to: "all", kind: "heads-up", text: TEXT }).then(async (answer) => [answer.status, await answer.text()] as const);
    await until(() => entered.calls > before);

    const stopping = running.close();
    await delay(RELEASED_AFTER_MS);
    await held.release();
    const [status, body] = await posting;
    await stopping;

    expect(status).toBe(200);
    expect((JSON.parse(body) as { result?: { isError?: boolean } }).result?.isError).not.toBe(true);
    expect((await readNotes(tracked.repo)).notes.filter((note) => note.text === TEXT)).toHaveLength(1);
  });

  test("that outlives the grace does not hold the stop, and the log names it", async () => {
    const { running, tracked, call, operator } = await serving(SHORT_GRACE_MS);
    const session = await operator(revision);
    const held = await holding(notesPath(tracked.repo));
    const said: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      said.push(String(chunk));
      return true;
    });
    const before = entered.calls;
    const posting = call(revision, "note_post", { sessionId: session, to: "all", kind: "heads-up", text: TEXT }).catch(() => undefined);
    await until(() => entered.calls > before);

    const started = Date.now();
    await running.close();
    const tookMs = Date.now() - started;
    await held.release();
    await posting;

    expect(tookMs).toBeLessThan(SHORT_GRACE_MS + MARGIN_MS);
    expect(said.filter((line) => line.includes("note_post"))).toHaveLength(1);
  });
});
