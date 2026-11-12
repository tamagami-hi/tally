import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

describe("a session's first call", () => {
  test("in a repository that keeps its context as records, session_open answers with the brief", async () => {
    const { repo, root, trees } = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(repo));
    const operator = await opened(call, root, "operator");
    await call("project_set", { sessionId: operator, purpose: "Replay market data." });
    await call("context_put", { sessionId: operator, kind: "rule", title: "Never push main", text: "Pushing is the operator's." });
    await call("context_put", { sessionId: operator, kind: "convention", title: "errors are TallyError", text: "x" });
    await call("question_add", { sessionId: operator, group: "platform", question: "Lots?", meanwhile: "refused" });

    const answer = await call("session_open", { worktree: trees["data"]!, agent: "claude" });

    expect(answer.isError).toBe(false);
    expect(answer.structured).toMatchObject({ track: "data", agent: "claude", repo: repo.name });
    expect(answer.structured["brief"]).toMatchObject({
      project: { purpose: "Replay market data." },
      rules: [{ id: "rule-1", title: "Never push main", text: "Pushing is the operator's." }],
      track: { name: "data", tasks: [{ milestone: "B2", id: "4 manifest" }, { milestone: "B2", id: "5 transcoder" }], handoff: null },
      entries: [{ id: "convention-1", kind: "convention", title: "errors are TallyError" }],
      working: [{ track: "main", agent: "operator" }],
      openQuestions: 1,
      missing: ["no area", "no howto"],
    });
    expect(JSON.parse(answer.text)).toEqual(answer.structured);
  });

  test("in any other repository, session_open answers exactly as it did, with no brief", async () => {
    const { repo, trees } = await makeTracked();
    const { call } = await connect(repo);

    const answer = await call("session_open", { worktree: trees["data"]!, agent: "claude" });

    expect(Object.keys(answer.structured)).toEqual(["id", "track", "worktree", "branch", "agent", "openedAt", "lastSeenAt", "repo", "runner"]);
  });

  test("context_pack at the project level is built from the records of such a repository, and from its Markdown elsewhere", async () => {
    const { repo, root } = await makeTracked();
    const records = (await connect(keepingContextAsRecords(repo))).call;
    const markdown = (await connect(repo)).call;
    const operator = await opened(records, root, "operator");
    await records("context_put", { sessionId: operator, kind: "rule", title: "Never push main", text: "Pushing is the operator's." });

    const fromRecords = await records("context_pack", { level: "project" });
    const fromMarkdown = await markdown("context_pack", { level: "project" });

    expect(fromRecords.text).toContain("## Rules\n\n### rule-1. Never push main\n\nPushing is the operator's.");
    expect(fromRecords.text).not.toContain("RULES.md");
    expect((fromRecords.structured["parts"] as Record<string, unknown>)["rules"]).toMatchObject([{ id: "rule-1" }]);
    expect(fromMarkdown.text).toContain("## RULES.md\n\n# Rules\n\n1. Keep it simple.\n");
    expect(fromMarkdown.text).toContain("(no CLAUDE.md)");
    expect((fromMarkdown.structured["parts"] as Record<string, unknown>)["rules"]).toBe("# Rules\n\n1. Keep it simple.\n");
  });
});
