import { rm } from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { Endpoints } from "../src/endpoints.ts";
import { Watcher } from "../src/watcher.ts";
import { service } from "./support/service.ts";
import { gatedCall } from "./support/gated.ts";
import { REVISIONS, requestAt } from "./support/revisions.ts";
import { stateDirOf } from "../../core/src/repos/home.ts";
import { addRepo, removeRepo } from "../../core/src/repos/list.ts";
import { Records } from "../../core/src/store/records.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { until } from "../../mcp/tests/support/newer.ts";

const made = vi.hoisted(() => ({ entered: 0, closing: 0, served: [] as number[], count: 0 }));

vi.mock("@tally/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/mcp")>();
  return {
    ...actual,
    mcpEndpoint: (...args: Parameters<typeof actual.mcpEndpoint>) => {
      const real = actual.mcpEndpoint(...args);
      made.count += 1;
      const number = made.count;
      return {
        ...real,
        fetch: async (request: Request) => {
          made.entered += 1;
          const answer = await real.fetch(request);
          made.served.push(number);
          return answer;
        },
        close: (...closing: Parameters<typeof real.close>) => {
          made.closing += 1;
          return real.close(...closing);
        },
      };
    },
  };
});

const STOPPING = "tally is stopping; call again in a moment, once it is back";

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(made, { entered: 0, closing: 0, served: [], count: 0 });
});

function heardLog(): string[] {
  const said: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => said.push(String(chunk)) > 0);
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void said.push(parts.map(String).join(" ")));
  return said;
}

interface Answered {
  result?: { structuredContent?: { rows?: unknown[] } };
  error?: { code: number; message: string };
  id?: unknown;
}

const rowsOf = async (answer: Response): Promise<number | undefined> => ((await answer.json()) as Answered).result?.structuredContent?.rows?.length;

describe.each(REVISIONS)("a request that meets a handler closed under it, on %s", (revision) => {
  test("when its repository is listed again at another folder, is served by the new handler, from the new folder", async () => {
    const { app, home, hub } = await service();
    const moved = await makeTracked();
    await new Records(moved.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));
    const gated = gatedCall("/r/beta/mcp", revision, "tools/call", { name: "board_get", arguments: {} });
    const answering = app.request(gated.request);
    await until(() => made.entered === 1);
    await removeRepo(home, "beta");
    await rm(stateDirOf(home, "beta"), { recursive: true, force: true });
    await addRepo(home, { root: moved.root, name: "beta" });

    const syncing = hub.sync();
    await until(() => made.closing === 1);
    gated.open();
    const answer = await answering;
    await syncing;

    expect([answer.status, await rowsOf(answer)]).toEqual([200, 0]);
    expect(made.served).toEqual([2]);
  });

  test("when its repository is taken off the list, is answered that the repository is not listed", async () => {
    const { app, home, hub } = await service();
    const gated = gatedCall("/r/beta/mcp", revision, "tools/call", { name: "board_get", arguments: {} });
    const answering = app.request(gated.request);
    await until(() => made.entered === 1);
    await removeRepo(home, "beta");

    const syncing = hub.sync();
    await until(() => made.closing === 1);
    gated.open();
    const answer = await answering;
    await syncing;

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "no repository beta is listed; repo_list names those that are" });
  });

  test("when the service is stopping, is refused with 503 in tally's words, in JSON-RPC, and nothing is logged", async () => {
    const { app, endpoints } = await service();
    const gated = gatedCall("/mcp", revision, "tools/call", { name: "board_get", arguments: {} });
    const inFlight = app.request(gated.request);
    await until(() => made.entered === 1);
    const said = heardLog();

    const stopping = endpoints.close();
    const late = await app.request(requestAt("/mcp", revision, "tools/list", {}));
    gated.open();
    const answered = await inFlight;
    await stopping;

    expect([late.status, late.headers.get("content-type")]).toEqual([503, "application/json"]);
    expect(await late.json()).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: STOPPING } });
    expect(answered.status).toBe(200);
    expect(said).toEqual([]);
  });

  test("when a server of one repository is stopping, is refused the same way", async () => {
    const { repo } = await makeTracked();
    const endpoints = new Endpoints();
    const watcher = new Watcher(repo);
    const app = createApp({ repo, watcher, webDir: repo.root, endpoints });
    await app.request(requestAt("/mcp", revision, "tools/list", {}));
    const said = heardLog();

    await endpoints.close();
    const late = await app.request(requestAt("/mcp/builder", revision, "tools/list", {}));

    expect(late.status).toBe(503);
    expect(((await late.json()) as Answered).error?.message).toBe(STOPPING);
    expect(said).toEqual([]);
  });
});
