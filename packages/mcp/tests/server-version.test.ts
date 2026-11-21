import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { SERVER_VERSION } from "../src/server.ts";
import { TOOL_META, newestTools } from "../src/meta.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";
import { newerInit } from "./support/newer.ts";
import { mcpEndpoint } from "../src/endpoint.ts";

const VERSION = "0.9.2";

const PACKAGES = ["../../../package.json", "../../core/package.json", "../../cli/package.json", "../package.json", "../../server/package.json", "../../web/package.json"];
const SINCE_0_2 = ["phase_add", "phase_close", "phase_list", "records_commit", "rule_tailor", "rulebook_adopt", "rulebook_get"];
const SINCE_0_3 = ["deferred_list", "deferred_set", "question_edit", "review_list", "review_record"];
const SINCE_0_7 = ["cycle_close", "cycle_list", "milestone_edit", "milestone_remove", "track_edit"];
const SINCE_0_8 = ["covering", "decision_record", "decision_status", "question_answer"];
const SINCE_0_9 = ["evidence_manual", "release_list", "release_mark", "trial_end", "trial_start"];

const versionOf = async (path: string): Promise<string> => (JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as { version: string }).version;

describe("the server's version", () => {
  test("is every package's, 0.9.2, and the handshake carries it on both revisions", async () => {
    const { repo } = await makeTracked();
    const { client } = await connect(repo);
    const endpoint = mcpEndpoint(repo);

    const discovered = (await (await endpoint.fetch(new Request("http://127.0.0.1/mcp", newerInit("server/discover", {})))).json()) as { result: { _meta: Record<string, { version?: string }> } };
    await endpoint.close();

    expect(await Promise.all(PACKAGES.map(versionOf))).toEqual(PACKAGES.map(() => VERSION));
    expect(SERVER_VERSION).toBe(VERSION);
    expect(client.getServerVersion()?.version).toBe(VERSION);
    expect(discovered.result._meta["io.modelcontextprotocol/serverInfo"]?.version).toBe(VERSION);
  });

  test("marks each tool added from 0.2.0 on with the version that added it", () => {
    const since = (version: string): string[] => Object.entries(TOOL_META).filter(([, meta]) => meta.since === version).map(([name]) => name).sort();

    expect(since("0.2.0")).toEqual(SINCE_0_2);
    expect(since("0.3.0")).toEqual(SINCE_0_3);
    expect(since("0.7.0")).toEqual(SINCE_0_7);
    expect(since("0.8.0")).toEqual(SINCE_0_8);
    expect(since("0.9.0")).toEqual(SINCE_0_9);
  });

  test("names as newest exactly the tools of the two latest versions that added one: 0.8.0 and 0.9.0", () => {
    expect([...newestTools()].sort()).toEqual([...SINCE_0_8, ...SINCE_0_9].sort());
  });

  test("is answered by session_open and repo_list, with the tool count and the newest tools", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const opened = await call("session_open", { worktree: tracked.trees["data"]!, agent: "claude", brief: "land" });
    const listed = await call("repo_list");

    const server = { version: VERSION, tools: Object.keys(TOOL_META).length, newest: [...newestTools()] };
    expect(opened.structured["server"]).toEqual(server);
    expect(listed.structured["server"]).toEqual(server);
  });
});
