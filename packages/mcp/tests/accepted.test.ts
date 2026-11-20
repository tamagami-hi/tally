import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const { repo, trees } = await makeTracked();
  const { call, client } = await connect(repo);
  return { call, client, trees, data: await opened(call, trees["data"]!) };
}

describe("an argument a tool does not take", () => {
  test("is refused with the tool's own parameters listed", async () => {
    const { call } = await serving();

    const refused = await call("decision_list", { groups: "platform" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("decision_list takes no 'groups'; it takes group, ids, limit, sessionId, repo");
  });

  test("given as repo to a writing tool, says the repository is the session's", async () => {
    const { call, data } = await serving();

    const refused = await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest", repo: "alpha" });

    expect(refused.text).toContain("task_claim takes no 'repo'; it takes sessionId, milestone, task");
    expect(refused.text).toContain("a writing tool takes sessionId; its repository is its session's");
  });

  test("given as cwd to session_open, names worktree", async () => {
    const { call, trees } = await serving();

    const refused = await call("session_open", { cwd: trees["data"]!, agent: "claude" });

    expect(refused.text).toContain("session_open takes no 'cwd'");
    expect(refused.text).toContain("session_open takes worktree: the folder you work in");
  });
});

describe("the lists' limit", () => {
  test("holds at most 200 on evidence_list, note_list, decision_list and question_list", async () => {
    const { call, data } = await serving();

    const answers = await Promise.all([
      call("evidence_list", { milestone: "B2", limit: 201 }),
      call("note_list", { sessionId: data, limit: 201 }),
      call("decision_list", { limit: 201 }),
      call("question_list", { limit: 201 }),
    ]);

    expect(answers.map((answer) => answer.isError)).toEqual([true, true, true, true]);
    expect(answers.every((answer) => answer.text.includes("200"))).toBe(true);
  });
});

describe("the server's capabilities", () => {
  test("say its tool list does not change, as it keeps no connection it could tell", async () => {
    const { client } = await serving();

    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
  });
});
