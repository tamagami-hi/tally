import { ToolSchema } from "@modelcontextprotocol/core";
import { describe, expect, test } from "vitest";
import { annotationsOf, metaOf } from "../src/meta.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

const PROTOCOL_DEFAULTS: Readonly<Record<string, boolean>> = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const HINTS = Object.keys(PROTOCOL_DEFAULTS);

type Entry = Record<string, unknown> & { name: string; annotations?: Record<string, unknown>; inputSchema: Record<string, unknown> };

async function entries(): Promise<{ tools: Entry[]; call: Awaited<ReturnType<typeof connect>>["call"] }> {
  const { repo } = await makeTracked();
  const { client, call } = await connect(repo);
  return { tools: (await client.listTools()).tools as Entry[], call };
}

const said = (entry: Entry, hint: string): unknown => entry.annotations?.[hint];
const effective = (entry: Entry, hint: string): boolean => (said(entry, hint) as boolean | undefined) ?? PROTOCOL_DEFAULTS[hint]!;

describe("what a tool's entry in the list holds", () => {
  test("no $schema in its input and no execution block that says only the protocol's default", async () => {
    const { tools } = await entries();

    expect(tools.filter((tool) => "$schema" in tool.inputSchema).map((tool) => tool.name)).toEqual([]);
    expect(tools.filter((tool) => "execution" in tool).map((tool) => tool.name)).toEqual([]);
  });

  test("no additionalProperties false at any depth of an input, while an argument the tool does not take is still refused, naming those it takes", async () => {
    const { tools, call } = await entries();

    const saying = tools.filter((tool) => JSON.stringify(tool.inputSchema).includes('"additionalProperties":false')).map((tool) => tool.name);
    const refused = await call("decision_list", { groups: ["core"] });
    const nested = await call("track_open", { sessionId: "s-none", name: "lane", purpose: "a lane", plan: { milestone: "B2", tasks: ["t"], extra: true } });

    expect(saying).toEqual([]);
    expect(refused).toMatchObject({ isError: true, text: "Invalid arguments for tool decision_list: decision_list takes no 'groups'; it takes group, ids, unconfirmed, limit, sessionId, repo" });
    expect(nested.isError).toBe(true);
    expect(nested.text).toContain("extra");
  });

    test("no integer bound that only restates the safe integer range, while a number past it is still refused", async () => {
    const { tools, call } = await entries();

    const listed = JSON.stringify(tools);
    const refused = await call("cycle_list", { n: 2 ** 60 });

    expect(listed).not.toContain("9007199254740991");
    expect(listed).toContain('"type":"integer"');
    expect(refused.isError).toBe(true);
  });

    test("a hint only where it differs from the protocol's default, and a read lists only what a read needs", async () => {
    const { tools } = await entries();

    const restated = tools.flatMap((tool) => HINTS.filter((hint) => said(tool, hint) === PROTOCOL_DEFAULTS[hint]).map((hint) => `${tool.name}.${hint}`));
    const readsSaying = tools.filter((tool) => said(tool, "readOnlyHint") === true).flatMap((tool) => ["destructiveHint", "idempotentHint"].filter((hint) => said(tool, hint) !== undefined).map((hint) => `${tool.name}.${hint}`));

    expect(restated).toEqual([]);
    expect(readsSaying).toEqual([]);
  });

  test("the hints a client reads with the protocol's defaults are those the table gives", async () => {
    const { tools } = await entries();

    const differing = tools.filter((tool) => {
      const meta = annotationsOf(metaOf(tool.name, "service")!);
      if (meta.readOnlyHint === true) return !effective(tool, "readOnlyHint") || effective(tool, "openWorldHint") !== meta.openWorldHint;
      return HINTS.some((hint) => effective(tool, hint) !== (meta as Record<string, boolean>)[hint]);
    });

    expect(differing.map((tool) => tool.name)).toEqual([]);
    expect(tools.filter((tool) => effective(tool, "readOnlyHint")).length).toBeGreaterThan(20);
  });

  test("is a valid tool by the protocol's own schema, and every tool can be called from it", async () => {
    const { tools, call } = await entries();

    expect(tools.filter((tool) => !ToolSchema.safeParse(tool).success).map((tool) => tool.name)).toEqual([]);
    for (const tool of tools) {
      const answer = await call(tool.name, {});
      expect(typeof answer.text).toBe("string");
    }
  });
});
