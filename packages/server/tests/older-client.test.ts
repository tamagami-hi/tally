import { afterEach, describe, expect, test, vi } from "vitest";
import { service } from "./support/service.ts";
import { ADDRESSES, BARE_HEADERS, answerOf, bareCall, joinedText } from "./support/wire.ts";

const UNBOUND = new Set<string>(["/mcp", "/mcp/builder", "/mcp/reviewer"]);
const UNKNOWN_ARGUMENT = "Invalid arguments for tool decision_list: decision_list takes no 'bogus'; it takes group, ids, unconfirmed, limit, sessionId, repo";
const NO_SESSION = "no session s-none; open one with session_open";
const JSON_TYPE = /^application\/json/;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectOneJsonBody(response: Response): Promise<Awaited<ReturnType<typeof answerOf>>> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(JSON_TYPE);
  return answerOf(response);
}

async function expectRefused(response: Response, text: string): Promise<void> {
  const answer = await expectOneJsonBody(response);
  expect(answer.error).toBeUndefined();
  expect(answer.result?.isError).toBe(true);
  expect(joinedText(answer)).toBe(text);
}

describe.each(ADDRESSES)("a bare POST with no handshake, as an older client's script sends it, at %s", (path) => {
  test("is answered as one JSON body, and a read that names no repository is one JSON value", async () => {
    const { app } = await service();

    const answer = await expectOneJsonBody(await bareCall(app, path, "decision_list"));
    const read = JSON.parse(joinedText(answer)) as Record<string, unknown>;

    expect(answer.result?.isError).toBeUndefined();
    expect(read["decisions"]).toEqual([]);
    expect(read["repo"]).toBe(UNBOUND.has(path) ? "alpha" : undefined);
  });

  test("a refused call is one JSON body with tally's own words", async () => {
    const { app } = await service();

    await expectRefused(await bareCall(app, path, "decision_list", { bogus: 1 }), UNKNOWN_ARGUMENT);
    await expectRefused(await bareCall(app, path, "session_close", { sessionId: "s-none" }), NO_SESSION);
  });

  test("a GET opens an event stream, and a DELETE answers 200 with no body", async () => {
    const { app } = await service();

    const got = await app.request(path, { method: "GET", headers: { accept: BARE_HEADERS.accept } });
    const deleted = await app.request(path, { method: "DELETE", headers: { accept: BARE_HEADERS.accept } });

    expect([got.status, got.headers.get("content-type")]).toEqual([200, "text/event-stream"]);
    await got.body?.cancel();
    expect([deleted.status, await deleted.text()]).toEqual([200, ""]);
  });
});

describe("a bare POST where no command runs", () => {
  test("is answered as in the service, with the same refusals", async () => {
    vi.stubEnv("TALLY_COMMANDS", "agent");
    const { app } = await service();

    const answer = await expectOneJsonBody(await bareCall(app, "/mcp", "decision_list"));

    expect((JSON.parse(joinedText(answer)) as Record<string, unknown>)["repo"]).toBe("alpha");
    await expectRefused(await bareCall(app, "/mcp", "decision_list", { bogus: 1 }), UNKNOWN_ARGUMENT);
    await expectRefused(await bareCall(app, "/mcp", "session_close", { sessionId: "s-none" }), NO_SESSION);
  });
});

describe("a bare call to a tool the address does not serve", () => {
  test.each([["/mcp", "no_such_tool"], ["/mcp/builder", "cycle_close"], ["/r/alpha/mcp/reviewer", "cycle_close"]])("at %s is the SDK's protocol error -32602 naming the tool, in one JSON body", async (path, tool) => {
    const { app } = await service();

    const answer = await expectOneJsonBody(await bareCall(app, path, tool));

    expect(answer.result).toBeUndefined();
    expect(answer.error).toEqual({ code: -32602, message: `Tool ${tool} not found` });
  });
});
