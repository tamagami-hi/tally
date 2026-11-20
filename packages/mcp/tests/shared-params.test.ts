import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

const SHARED: Readonly<Record<string, string>> = {
  sessionId: "from session_open",
  repo: "a repo_list name, else the default",
  limit: "at most this many",
  fields: "the keys of each item to keep",
};

const OWN_MEANING = new Set(["board_get.fields"]);

interface Listed {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, { description?: string; default?: unknown }> };
}

describe("the parameters many tools share", () => {
  test("say one short text each, wherever they appear", async () => {
    const { repo } = await makeTracked();
    const { client } = await connect(repo);
    const tools = (await client.listTools()).tools as Listed[];

    const other = tools.flatMap((tool) => Object.entries(tool.inputSchema.properties ?? {})
      .filter(([param]) => SHARED[param] !== undefined && !OWN_MEANING.has(`${tool.name}.${param}`))
      .filter(([param, property]) => property.description !== SHARED[param])
      .map(([param, property]) => `${tool.name}.${param}: ${property.description ?? ""}`));

    expect(other).toEqual([]);
  });

  test("leave what a limit keeps, and how many by default, to the tool's description or the schema", async () => {
    const { repo } = await makeTracked();
    const { client } = await connect(repo);
    const tools = (await client.listTools()).tools as Listed[];

    const unsaid = tools.filter((tool) => tool.inputSchema.properties?.["limit"] !== undefined)
      .filter((tool) => tool.inputSchema.properties?.["limit"]?.default === undefined && !/\d+ unless `limit` says|`limit`/.test(tool.description ?? ""))
      .map((tool) => tool.name);

    expect(unsaid).toEqual([]);
  });
});
