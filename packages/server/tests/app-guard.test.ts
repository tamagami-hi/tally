import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Watcher } from "../src/watcher.ts";
import { REVISIONS, requestAt } from "./support/revisions.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

async function oneRepository() {
  const { repo } = await makeTracked();
  return createApp({ repo, watcher: new Watcher(repo), webDir: repo.root });
}

describe.each(REVISIONS)("a server of one repository, on %s", (revision) => {
  test("refuses another host, and a page of another site, as the service does", async () => {
    const app = await oneRepository();
    const asked = async (headers: Record<string, string>): Promise<number> => {
      const request = requestAt("/mcp", revision, "tools/list", {});
      return (await app.request(new Request(request, { headers: { ...Object.fromEntries(request.headers), ...headers } }))).status;
    };

    expect(await asked({ host: "tally.example.org" })).toBe(403);
    expect(await asked({ host: "127.0.0.1", origin: "https://elsewhere.example.org" })).toBe(403);
    expect(await asked({ host: "127.0.0.1" })).toBe(200);
  });
});

describe("a server of one repository", () => {
  test("answers a refusal in JSON, in tally's words, as the service does", async () => {
    const app = await oneRepository();

    const refused = await app.request("/api/cycles/1/done");

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "cycle 1 is the current cycle: leave `cycle` out to read the current cycle" });
  });
});
