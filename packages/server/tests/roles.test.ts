import { describe, expect, test } from "vitest";
import { ROLE_TOOLS } from "../../mcp/src/roles.ts";
import { service } from "./service.test.ts";

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

async function listedAt(app: Awaited<ReturnType<typeof service>>["app"], path: string): Promise<string[]> {
  const response = await app.request(path, { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const answer = (await response.json()) as { result: { tools: { name: string }[] } };
  return answer.result.tools.map((tool) => tool.name).sort();
}

describe("the roles over HTTP", () => {
  test("each role's address serves its set, for the service and under a repository, and the plain address every tool", async () => {
    const { app } = await service();

    expect(await listedAt(app, "/mcp/builder")).toEqual([...ROLE_TOOLS.builder].sort());
    expect(await listedAt(app, "/r/alpha/mcp/reviewer")).toEqual([...ROLE_TOOLS.reviewer].sort());
    expect((await listedAt(app, "/mcp")).length).toBeGreaterThan(ROLE_TOOLS.builder.length);
    expect((await app.request("/r/nobody/mcp/builder", { method: "POST", headers: HEADERS, body: "{}" })).status).toBe(404);
  });

  test("/api/roles/<role> answers the definition with its protocol and an agent file, and an unknown role is 404 naming the roles", async () => {
    const { app } = await service();

    const builder = (await (await app.request("/api/roles/builder")).json()) as Record<string, unknown>;
    const unknown = await app.request("/api/roles/tester");

    expect(builder).toMatchObject({ role: "builder", address: "/mcp/builder", tools: ROLE_TOOLS.builder });
    expect(builder["agentFile"]).toEqual(expect.stringContaining("name: tally-builder"));
    expect(builder["protocol"]).toEqual(expect.stringContaining("session_open"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "no role tester; the roles are builder and reviewer" });
  });
});
