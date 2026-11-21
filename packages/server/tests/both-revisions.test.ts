import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { service } from "./support/service.ts";
import { REVISIONS, callerAt, namesAt, requestAt, type Fetching } from "./support/revisions.ts";
import { Usage, USAGE_FILE } from "../../core/src/usage/counts.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { Records } from "../../core/src/store/records.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { holding, pendingClose } from "../../core/tests/support/pending.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { mcpEndpoint } from "../../mcp/src/endpoint.ts";
import { ANSWER_LIMIT } from "../../mcp/src/decorators/sized.ts";
import { ROLE_TOOLS } from "../../mcp/src/roles.ts";
import { keepingContextAsRecords } from "../../mcp/tests/support/connect.ts";

const QUESTIONS = 15;
const BUSY = "a cycle close is being finished: try again in a moment; until it is, a tool that writes is refused";
const CWD_HINT = "Invalid arguments for tool session_open: Invalid input: expected string, received undefined at worktree\nsession_open takes no 'cwd'; it takes worktree, track, agent, brief; session_open takes worktree: the folder you work in";
const REPO_HINT = "a writing tool takes sessionId; its repository is its session's";

const through = (app: Awaited<ReturnType<typeof service>>["app"]): Fetching => async (request) => app.request(request);

describe.each(REVISIONS)("the same service on %s", (revision) => {
  test("counts a call once with the address it came by, and a refused call as invalid", async () => {
    const usage = await Usage.open(join(await tmpDir("tally-usage-"), USAGE_FILE), "0.9.3");
    const { app } = await service(usage);
    const call = callerAt(through(app), "/mcp/builder", revision);

    await call("board_get");
    await call("board_get", { nonsense: true });

    expect(usage.snapshot().tools["board_get"]).toMatchObject({ calls: 1, invalid: 1, via: { builder: 1 }, repos: { alpha: 1 } });
  });

  test("cuts a large answer to 25,000 characters and says what it cut", async () => {
    const { app, alpha } = await service();
    const call = callerAt(through(app), "/mcp", revision);
    const asking = (await call("session_open", { worktree: alpha.trees["data"]!, agent: "claude" })).structured["id"];
    for (let n = 0; n < QUESTIONS; n += 1) await call("question_add", { sessionId: asking, group: "g", question: `${n} ${"why ".repeat(490)}`, meanwhile: "wait" });

    const listed = await call("question_list");

    expect(listed.structured).toMatchObject({ repo: "alpha", truncated: [expect.objectContaining({ path: "open" })] });
    expect(listed.text.length).toBeLessThanOrEqual(ANSWER_LIMIT);
  });

  test("gives the hints for cwd and for repo", async () => {
    const { app, alpha } = await service();
    const call = callerAt(through(app), "/mcp", revision);
    const session = (await call("session_open", { worktree: alpha.trees["data"]!, agent: "claude" })).structured["id"];

    const cwd = await call("session_open", { cwd: alpha.trees["data"]!, agent: "claude" });
    const repo = await call("note_post", { sessionId: session, repo: "alpha", to: "all", kind: "heads-up", text: "x" });

    expect([cwd.isError, cwd.text]).toEqual([true, CWD_HINT]);
    expect([repo.isError, repo.text.endsWith(REPO_HINT)]).toEqual([true, true]);
  });

  test("serves a role's set at its address, and a repository's address reads that repository", async () => {
    const { app, hub } = await service();
    await new Records(await hub.repos.get("beta")).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));
    const rowsAt = async (path: string): Promise<number> => ((await callerAt(through(app), path, revision)("board_get")).structured["rows"] as unknown[]).length;

    expect(await namesAt(through(app), "/r/beta/mcp/reviewer", revision)).toEqual([...ROLE_TOOLS.reviewer].sort());
    expect([await rowsAt("/r/alpha/mcp") > 0, await rowsAt("/r/beta/mcp")]).toEqual([true, 0]);
  });

  test("refuses a write while a cycle's close is being finished elsewhere, and still answers a read", async () => {
    const made = await cycling({ commit: false });
    const repo = keepingContextAsRecords(made.repo);
    const endpoint = mcpEndpoint(repo);
    const call = callerAt(endpoint.fetch, "/mcp", revision);
    const operator = (await call("session_open", { worktree: made.root, agent: "operator" })).structured["id"];
    await pendingClose({ repo });
    const held = await holding(landingLockPath(repo));

    const written = await call("note_post", { sessionId: operator, to: "all", kind: "heads-up", text: "while it closes" });
    const read = await call("board_get");
    await held.release();
    await endpoint.close();

    expect([written.isError, written.text]).toEqual([true, BUSY]);
    expect(read.isError).toBe(false);
  });

  test("refuses another host, and a page of another site, for a call and for a listen stream", async () => {
    const { app } = await service();
    const asked = async (method: string, headers: Record<string, string>): Promise<number> => {
      const request = requestAt("/mcp", revision, method, method === "subscriptions/listen" ? { notifications: { toolsListChanged: true } } : {});
      return (await app.request(new Request(request, { headers: { ...Object.fromEntries(request.headers), ...headers } }))).status;
    };

    for (const method of ["tools/list", "subscriptions/listen"]) {
      expect(await asked(method, { host: "tally.example.org" })).toBe(403);
      expect(await asked(method, { host: "127.0.0.1", origin: "https://elsewhere.example.org" })).toBe(403);
    }
  });
});
