import { randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport, type ElicitResult } from "@modelcontextprotocol/client";
import { createRequestStateCodec } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, test } from "vitest";
import { askEndpoint } from "../src/endpoint.ts";
import { CANNOT_CARRY, NOBODY_AT_HAND, NO_FORM, UNSEALED, type Sealed } from "../src/tools/ask-trial.ts";
import type { McpEndpoint } from "../src/endpoint.ts";
import { NEWER, newerInit } from "./support/newer.ts";

const AT = "http://127.0.0.1/mcp/ask";
const ABOUT = "Close cycle 3 now?";
const SAID = "yes, close it, the release is out";

const open: McpEndpoint[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

function endpoint(): McpEndpoint {
  const made = askEndpoint();
  open.push(made);
  return made;
}

async function asking(person: ElicitResult | undefined) {
  const served = endpoint();
  const asked: string[] = [];
  const client = new Client({ name: "agent", version: "0" }, { ...(person === undefined ? {} : { capabilities: { elicitation: { form: {} } } }), versionNegotiation: { mode: { pin: NEWER } } });
  if (person !== undefined) {
    client.setRequestHandler("elicitation/create", async (request) => {
      asked.push(request.params.message);
      return person;
    });
  }
  await client.connect(new StreamableHTTPClientTransport(new URL(AT), { fetch: (url, init) => served.fetch(new Request(url, init)) }));
  const result = await client.callTool({ name: "ask_trial", arguments: { about: ABOUT } });
  await client.close();
  return { asked, result: result as { isError?: boolean; structuredContent?: Record<string, unknown> } };
}

interface Round {
  result?: { resultType?: string; requestState?: string; structuredContent?: Record<string, unknown>; isError?: boolean; content?: { text?: string }[] };
}

const FORMS = { elicitation: { form: {} } };

const raw = async (served: McpEndpoint, params: Record<string, unknown>): Promise<Round> => (await (await served.fetch(new Request(AT, newerInit("tools/call", { name: "ask_trial", ...params }, undefined, FORMS)))).json()) as Round;

const ACCEPTED = { confirm: { action: "accept", content: { confirm: true, said: SAID } } };

describe("ask_trial, on 2026-07-28", () => {
  test("asks the person once and answers what they accepted, in their own words", async () => {
    const { asked, result } = await asking({ action: "accept", content: { confirm: true, said: SAID } });

    expect(asked).toEqual([ABOUT]);
    expect(result.structuredContent).toEqual({ asked: true, action: "accept", about: ABOUT, confirmed: true, said: SAID, waitedMs: expect.any(Number) });
  });

  test("takes a no as an answer and does not ask again", async () => {
    const { asked, result } = await asking({ action: "accept", content: { confirm: false, said: "not yet, one track is open" } });

    expect(asked).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({ asked: true, action: "accept", confirmed: false, said: "not yet, one track is open" });
  });

  test.each(["decline", "cancel"] as const)("answers a %s, and says what a cancel can mean", async (action) => {
    const { asked, result } = await asking({ action });

    expect(asked).toHaveLength(1);
    expect(result.structuredContent).toEqual({ asked: true, action, about: ABOUT, waitedMs: expect.any(Number), note: NOBODY_AT_HAND });
  });

  test("does not ask a client that declares no elicitation, and says so", async () => {
    const { result } = await asking(undefined);

    expect(result.structuredContent).toEqual({ asked: false, reason: NO_FORM });
  });

  test("answers from what it sealed, not from the second call's arguments", async () => {
    const served = endpoint();
    const first = await raw(served, { arguments: { about: ABOUT } });

    const second = await raw(served, { arguments: { about: "Delete every record?" }, inputResponses: ACCEPTED, requestState: first.result?.requestState });

    expect(first.result?.resultType).toBe("input_required");
    expect(second.result?.structuredContent).toMatchObject({ asked: true, about: ABOUT, said: SAID });
  });

  test("refuses a state another key sealed, as after a restart, and says to call again", async () => {
    const served = endpoint();
    const elsewhere = createRequestStateCodec<Sealed>({ key: randomBytes(32) });

    const answer = await raw(served, { arguments: { about: ABOUT }, inputResponses: ACCEPTED, requestState: await elsewhere.mint({ about: ABOUT, askedAt: Date.now() }) });

    expect([answer.result?.isError, answer.result?.content?.[0]?.text]).toEqual([true, UNSEALED]);
  });
});

describe("ask_trial, on a 2025 revision", () => {
  test("cannot ask over this stateless address, and says so beforehand", async () => {
    const served = endpoint();

    const answered = await served.fetch(new Request(AT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_trial", arguments: { about: ABOUT } } }) }));

    expect(((await answered.json()) as Round).result?.structuredContent).toEqual({ asked: false, reason: CANNOT_CARRY });
  });
});
