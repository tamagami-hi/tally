import { describe, expect, test } from "vitest";
import { TOOL_META } from "../src/meta.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";
import { destroys, withDefaults } from "./support/hints.ts";

interface Listed {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: { properties?: Record<string, { description?: string }>; additionalProperties?: unknown };
}

async function listedAt(place: "service" | "agent"): Promise<Listed[]> {
  const { repo } = await makeTracked();
  const { client } = await connect(repo, place);
  return (await client.listTools()).tools as Listed[];
}

const listed = (): Promise<Listed[]> => listedAt("service");

const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

describe("what every tool says about itself", () => {
  test("a title, and the four hints a client decides with", async () => {
    const tools = await listed();

    const bare = tools.filter((tool) => typeof tool.title !== "string" || tool.title === "" || HINTS.some((hint) => typeof withDefaults(tool.annotations)[hint] !== "boolean"));

    expect(bare.map((tool) => tool.name)).toEqual([]);
  });

  test("what each of its arguments is", async () => {
    const tools = await listed();

    const undescribed = tools.flatMap((tool) => Object.entries(tool.inputSchema.properties ?? {}).filter(([, property]) => (property.description ?? "") === "").map(([name]) => `${tool.name}.${name}`));

    expect(undescribed).toEqual([]);
  });

  test("the table of titles names exactly the tools the server has", async () => {
    const tools = await listed();

    expect(Object.keys(TOOL_META).sort()).toEqual(tools.map((tool) => tool.name).sort());
  });
});

describe("the hints", () => {
  test("mark a tool that only reads as read-only, and no other", async () => {
    const tools = await listed();
    const readOnly = tools.filter((tool) => withDefaults(tool.annotations)["readOnlyHint"] === true).map((tool) => tool.name).sort();

    expect(readOnly).toEqual(["activity_get", "board_get", "buildlog_render", "checks_fingerprint", "checks_get", "context_get", "context_pack", "covering", "cycle_list", "decision_list", "deferred_list", "docs_list", "docs_read", "docs_search", "evidence_list", "handoff_read", "inbox_get", "ledger_check", "lock_list", "note_list", "phase_list", "question_list", "repo_list", "review_list", "rulebook_get", "session_list", "track_list"]);
  });

  test("mark as destructive only what removes or overwrites, and the tool that runs any command it is given", async () => {
    const tools = await listed();
    const destructive = tools.filter((tool) => destroys(tool.annotations)).map((tool) => tool.name).sort();

    expect(destructive).toEqual(["checks_set", "cycle_close", "decision_status", "deferred_set", "evidence_run", "handoff_write", "milestone_remove", "phase_close", "project_set", "repo_configure", "task_remove", "track_close", "views_claude"]);
  });

  test("say that only the two tools that run a command reach outside the repository", async () => {
    const tools = await listed();

    expect(tools.filter((tool) => withDefaults(tool.annotations)["openWorldHint"] === true).map((tool) => tool.name).sort()).toEqual(["evidence_run", "land_run"]);
  });
});

describe("an argument the tool does not have", () => {
  test("is refused by name, and nothing is done", async () => {
    const { repo } = await makeTracked();
    const { call } = await connect(repo);

    const mistyped = await call("decision_list", { groups: "platform" });

    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("groups");
  });
});

describe("the size of what the tools say", () => {
  const MOST_NEW_DESCRIPTION = 700;
  const MOST_SESSION_OPEN = 1_600;

  test("keeps each description of a tool added with the rulebook under 700 characters, and session_open's under 1,600", async () => {
    const tools = await listed();
    const length = (name: string): number => tools.find((tool) => tool.name === name)?.description?.length ?? Number.POSITIVE_INFINITY;

    expect(["rulebook_get", "rulebook_adopt", "rule_tailor"].filter((name) => length(name) >= MOST_NEW_DESCRIPTION)).toEqual([]);
    expect(length("rulebook_get")).toBeGreaterThan(0);
    expect(length("session_open")).toBeLessThan(MOST_SESSION_OPEN);
  });

  const TIGHTENED = ["session_open", "track_open", "land_start", "land_run", "phase_close", "ledger_check", "evidence_run", "track_close", "task_land", "board_get"];
  const TIGHTENED_IN_061 = 6_062;
  const MOST_TIGHTENED = 5_700;

  test("keeps the ten descriptions that were longest in 0.6.1 together under 5,700 characters, where they were 6,062", async () => {
    const tools = await listed();
    const total = tools.filter((tool) => TIGHTENED.includes(tool.name)).reduce((sum, tool) => sum + (tool.description ?? "").length, 0);

    expect(total).toBeLessThan(MOST_TIGHTENED);
    expect(total).toBeLessThan(TIGHTENED_IN_061);
  });
});

describe("the whole tool list", () => {
  const MOST_TOOLS_LIST = 77_000;

  test("stays under 77,000 characters as compact JSON, since every agent session reads it", async () => {
    const tools = await listed();

    expect(JSON.stringify(tools).length).toBeLessThan(MOST_TOOLS_LIST);
  });
});
