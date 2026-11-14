import { describe, expect, test } from "vitest";
import { addQuestion, answerQuestion, readQuestions, rowOf } from "../../src/records/questions.ts";
import { editQuestion } from "../../src/records/question-edit.ts";
import { collectInbox } from "../../src/state/inbox.ts";
import { openSession } from "../../src/state/sessions.ts";
import { makeTracked } from "../support/tracked.ts";

const SHARED = "claude-opus";

async function twoTracks() {
  const { repo, trees } = await makeTracked();
  const data = await openSession(repo, { worktree: trees["data"]!, agent: SHARED });
  const engine = await openSession(repo, { worktree: trees["engine"]!, agent: SHARED });
  await addQuestion(repo, { group: "store", question: "Keep the cache?", meanwhile: "keep it", by: SHARED, track: "data" });
  return { repo, data, engine };
}

describe("who may edit a question, when two tracks' agents share a name", () => {
  test("the asking track's session may, and the other track's may not", async () => {
    const { repo } = await twoTracks();

    await expect(editQuestion(repo, { agent: SHARED, track: "engine", operator: false }, { id: "Q-1", question: "x", why: "mine" })).rejects.toThrow(`only an operator session or ${SHARED} on track data, who asked Q-1, edits it; ask a new question that names it`);
    expect((await editQuestion(repo, { agent: SHARED, track: "data", operator: false }, { id: "Q-1", question: "Keep it as is?", why: "clearer" })).question.question).toBe("Keep it as is?");
  });

  test("a question asked before tracks were kept on questions is the operator's to edit", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, { group: "store", question: "Old?", meanwhile: "m" });

    await expect(editQuestion(repo, { agent: "claude", track: "data", operator: false }, { id: 1, question: "x", why: "w" })).rejects.toThrow("only an operator session edits Q-1; ask a new question that names it");
  });

  test("the operator's answer reaches the asking track's session only", async () => {
    const { repo, data, engine } = await twoTracks();
    const since = new Date(Date.now() - 60_000);
    await collectInbox(repo, data, since);
    await collectInbox(repo, engine, since);
    await answerQuestion(repo, 1, "Keep it.");

    expect((await collectInbox(repo, engine)).filter((item) => item.kind === "answer")).toEqual([]);
    expect((await collectInbox(repo, data)).filter((item) => item.kind === "answer")).toHaveLength(1);
  });
});

describe("question texts", () => {
  test("refuse an empty or blank question or meanwhile, and a why on more than one line, in words", async () => {
    const { repo } = await twoTracks();
    const editor = { agent: SHARED, track: "data", operator: false };

    await expect(editQuestion(repo, editor, { id: "Q-1", question: "", why: "w" })).rejects.toThrow("a question needs some text");
    await expect(editQuestion(repo, editor, { id: "Q-1", meanwhile: "   ", why: "w" })).rejects.toThrow("a question's meanwhile needs some text");
    await expect(editQuestion(repo, editor, { id: "Q-1", question: "x", why: "a\nb" })).rejects.toThrow("an edit's why is one line");
    await expect(addQuestion(repo, { group: "store", question: "  ", meanwhile: "m" })).rejects.toThrow("a question needs some text");
    expect((await readQuestions(repo))?.open[0]?.question).toBe("Keep the cache?");
  });
});

describe("question numbers", () => {
  test("refuse an id too large to be a row, and a number far past the next", async () => {
    const { repo } = await twoTracks();

    expect(() => rowOf("99999999999999999999999")).toThrow("'99999999999999999999999' is not a question's id; give it as Q-24 or 24");
    await expect(addQuestion(repo, { group: "store", question: "q", meanwhile: "m", number: 3700 }, { operator: true })).rejects.toThrow("the next question number is 2; a number may jump forward by at most 999 at once, so 3700 is refused as a slip");
  });
});
