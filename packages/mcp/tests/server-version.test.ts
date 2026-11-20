import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { SERVER_VERSION } from "../src/server.ts";
import { TOOL_META, newestTools } from "../src/meta.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

const PACKAGES = ["../../../package.json", "../../core/package.json", "../../cli/package.json", "../package.json", "../../server/package.json", "../../web/package.json"];
const SINCE_0_2 = ["phase_add", "phase_close", "phase_list", "records_commit", "rule_tailor", "rulebook_adopt", "rulebook_get"];
const SINCE_0_3 = ["deferred_list", "deferred_set", "question_edit", "review_list", "review_record"];
const SINCE_0_7 = ["milestone_edit", "milestone_remove", "track_edit"];

const versionOf = async (path: string): Promise<string> => (JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as { version: string }).version;

describe("the server's version", () => {
  test("is every package's, 0.6.1, and the handshake carries it", async () => {
    const { client } = await connect((await makeTracked()).repo);

    expect(await Promise.all(PACKAGES.map(versionOf))).toEqual(PACKAGES.map(() => "0.6.1"));
    expect(SERVER_VERSION).toBe("0.6.1");
    expect(client.getServerVersion()?.version).toBe("0.6.1");
  });

  test("marks each tool added from 0.2.0 on with the version that added it", () => {
    const since = (version: string): string[] => Object.entries(TOOL_META).filter(([, meta]) => meta.since === version).map(([name]) => name).sort();

    expect(since("0.2.0")).toEqual(SINCE_0_2);
    expect(since("0.3.0")).toEqual(SINCE_0_3);
    expect(since("0.7.0")).toEqual(SINCE_0_7);
  });

  test("names as newest exactly the tools of the two latest versions that added one: 0.3.0 and 0.7.0, as 0.4, 0.5 and 0.6 added none", () => {
    expect([...newestTools()].sort()).toEqual([...SINCE_0_3, ...SINCE_0_7].sort());
  });

  test("is answered by session_open and repo_list, with the tool count and the newest tools", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const opened = await call("session_open", { worktree: tracked.trees["data"]!, agent: "claude", brief: "land" });
    const listed = await call("repo_list");

    const server = { version: "0.6.1", tools: Object.keys(TOOL_META).length, newest: [...newestTools()] };
    expect(opened.structured["server"]).toEqual(server);
    expect(listed.structured["server"]).toEqual(server);
  });
});
