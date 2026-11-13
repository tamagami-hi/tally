import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

const isFolder = async (path: string): Promise<boolean> => (await stat(path)).isDirectory();

describe("where a session keeps its scratch", () => {
  test("session_open answers .temp/<track> in the track's worktree, and makes it", async () => {
    const { repo, trees } = await makeTracked();
    const { call } = await connect(repo);

    const answer = await call("session_open", { worktree: trees["data"]!, agent: "claude" });

    const scratch = join(trees["data"]!, ".temp", "data");
    expect(answer.structured["scratch"]).toBe(scratch);
    expect(await isFolder(scratch)).toBe(true);
  });

  test("an operator session's scratch is .temp/<main branch> in the repository", async () => {
    const { repo, root } = await makeTracked();
    const { call } = await connect(repo);

    const answer = await call("session_open", { worktree: root, agent: "operator" });

    expect(answer.structured["scratch"]).toBe(join(root, ".temp", "main"));
    expect(await isFolder(join(root, ".temp", "main"))).toBe(true);
  });

  test("track_open answers the new track's scratch, and makes it", async () => {
    const { repo, root } = await makeTracked();
    const { call } = await connect(repo);
    const operator = (await call("session_open", { worktree: root, agent: "operator" })).structured["id"];

    const made = await call("track_open", { sessionId: operator, name: "helper", purpose: "split the reader" });

    const scratch = join(root, ".temp/worktrees/helper/.temp/helper");
    expect(made.structured["scratch"]).toBe(scratch);
    expect(await isFolder(scratch)).toBe(true);
  });

  test("session_open and track_open say what the folder is for", async () => {
    const { repo } = await makeTracked();
    const { client } = await connect(repo);

    const tools = (await client.listTools()).tools;
    const said = (name: string): string => tools.find((tool) => tool.name === name)?.description ?? "";

    expect(said("session_open")).toContain("never /tmp or another hidden folder");
    expect(said("track_open")).toContain("`scratch`");
    expect(said("session_open").length).toBeLessThan(1_600);
  });

  test("repo_configure refuses a worktreeRoot outside .temp/ with the words that say why", async () => {
    const { repo, root } = await makeTracked();
    const { call } = await connect(repo);
    const operator = (await call("session_open", { worktree: root, agent: "operator" })).structured["id"];

    const refused = await call("repo_configure", { sessionId: operator, config: { worktreeRoot: "lanes" } });
    const accepted = await call("repo_configure", { sessionId: operator, config: { worktreeRoot: ".temp/lanes" } });

    expect(refused).toMatchObject({ isError: true, text: "worktrees live under .temp/, which git ignores; 'lanes' is not" });
    expect(accepted.isError).toBe(false);
  });
});
