import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { RUNNER, writeRunner } from "../../src/land/runner.ts";
import { advance } from "../../src/land/turn.ts";
import { postNote, replyNote } from "../../src/records/notes.ts";
import { addQuestion, answerQuestion } from "../../src/records/questions.ts";
import { takeResults } from "../../src/records/results.ts";
import { collectInbox, peekInbox } from "../../src/state/inbox.ts";
import { commitOn, edit } from "../support/landing.ts";
import { landing, ready } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const kinds = (items: { kind: string }[]): string[] => items.map((item) => item.kind);

describe("a session's inbox", () => {
  test("is empty when nothing happened", async () => {
    const q = await ready();

    expect(await collectInbox(q.repo, q.session)).toEqual([]);
  });

  test("delivers a note for its track once, and not its own notes", async () => {
    const q = await ready();
    await postNote(q.repo, q.engine.session, { to: ["data"], kind: "heads-up", text: "The reader moved." });
    await postNote(q.repo, q.session, { to: "all", kind: "finding", text: "my own" });

    const first = await collectInbox(q.repo, q.session);
    const second = await collectInbox(q.repo, q.session);

    expect(first).toEqual([expect.objectContaining({ kind: "note", from: "engine", text: "heads-up from engine (kiro): The reader moved." })]);
    expect(second).toEqual([]);
  });

  test("delivers a reply to a note it wrote", async () => {
    const q = await ready();
    const note = await postNote(q.repo, q.session, { to: ["engine"], kind: "request", text: "Expose the reader?" });
    await collectInbox(q.repo, q.session);
    await replyNote(q.repo, q.engine.session, note.id, "Yes, next landing.");

    expect(await collectInbox(q.repo, q.session)).toEqual([expect.objectContaining({ kind: "reply", text: `engine (kiro) replied to ${note.id}: Yes, next landing.` })]);
  });

  test("delivers the operator's answer to a question it asked", async () => {
    const q = await ready();
    const { question } = await addQuestion(q.repo, { group: "platform", question: "Which port?", meanwhile: "47560", by: "claude" });
    await collectInbox(q.repo, q.session);
    await answerQuestion(q.repo, question.row, "Keep 47560.");

    expect(await collectInbox(q.repo, q.session)).toEqual([expect.objectContaining({ kind: "answer", text: `the operator answered question ${question.row}: Keep 47560.` })]);
  });

  test("says when main changed a file the track has changed", async () => {
    const q = await ready();
    await commitOn(q.tree, "src/lib.rs", "feat: data edits lib", "fn data() {}\n");
    await collectInbox(q.repo, q.session);
    await writeFile(join(q.root, "src", "other.rs"), "x\n");
    await sh(q.root, ["add", "src/other.rs"]);
    await sh(q.root, ["commit", "-q", "-m", "feat: unrelated on main"]);
    await writeFile(join(q.root, "src", "lib.rs"), "fn main_side() {}\n");
    await sh(q.root, ["commit", "-q", "-am", "feat: main edits lib"]);

    const items = (await collectInbox(q.repo, q.session, new Date(Date.now() + 2000))).filter((item) => item.kind === "main");

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toMatch(/^main changed src\/lib\.rs, which this track has changed too \([0-9a-f]{7} feat: main edits lib\); rebase soon$/);
  });

  test("says when its landing has its turn, and how it ended", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await collectInbox(q.repo, q.session);
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    const turn = await collectInbox(q.repo, q.session);
    await advance(q.repo, new Date(Date.now() + 3 * 60_000));
    const ended = await collectInbox(q.repo, q.session, new Date(Date.now() + 4 * 60_000));

    expect(turn).toEqual([expect.objectContaining({ kind: "landing", text: expect.stringContaining(`ticket ${ticket.id} has its turn: run sh `) })]);
    expect(kinds(ended)).toEqual(["landing"]);
    expect(ended[0]?.text).toContain(`ticket ${ticket.id} failed: its turn timed out`);
  });

  test("says when a run was taken in or set aside", async () => {
    const q = await ready();
    await writeRunner(q.repo, q.tree, "data");
    await collectInbox(q.repo, q.session);
    await new Promise<void>((done) => execFile("sh", [join(q.tree, RUNNER), "green", "--", "true"], { cwd: q.tree }, () => done()));
    await takeResults(q.repo);

    const items = await collectInbox(q.repo, q.session, new Date(Date.now() + 2000));

    expect(items).toEqual([expect.objectContaining({ kind: "run", text: expect.stringContaining("a green run was set aside: the run names no task") })]);
  });

  test("says when a context entry was added or retired for the files it works on, and not for other files", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const about = await putEntry(q.repo, q.engine.session, { kind: "finding", title: "The reader caches its index", text: "Open it once.", paths: ["src"] });
    await putEntry(q.repo, q.engine.session, { kind: "finding", title: "The docs build is slow", text: "It takes a minute.", paths: ["docs/site"] });
    await putEntry(q.repo, q.engine.session, { kind: "convention", title: "Errors carry the file", text: "Name the path." });
    await putEntry(q.repo, q.session, { kind: "finding", title: "My own finding", text: "I know it already.", paths: ["src"] });

    const added = await collectInbox(q.repo, q.session);
    await retireEntry(q.repo, q.engine.session, about.entry.id, "the cache is gone");
    const retired = await collectInbox(q.repo, q.session);

    expect(added.map((item) => [item.kind, item.from, item.text])).toEqual([
      ["context", "engine", "engine (kiro) added the finding finding-1: The reader caches its index"],
      ["context", "engine", "engine (kiro) added the convention convention-1: Errors carry the file"],
    ]);
    expect(retired.map((item) => item.text)).toEqual(["finding-1 (The reader caches its index) was retired: the cache is gone"]);
  });

  test("does not tell a new session what happened before it opened", async () => {
    const q = await ready();
    const opened = new Date(Date.now() + 60_000);
    await postNote(q.repo, q.engine.session, { to: "all", kind: "finding", text: "before you came" }, new Date(opened.getTime() - 5_000));
    const late = { ...q.session, id: "a-later-session", openedAt: opened.toISOString() };

    expect(await collectInbox(q.repo, late, new Date(opened.getTime() + 1_000))).toEqual([]);
  });

  test("can be read again without being taken", async () => {
    const q = await ready();
    const before = new Date(Date.now() - 1000).toISOString();
    await postNote(q.repo, q.engine.session, { to: "all", kind: "finding", text: "worth knowing" });

    expect(kinds(await peekInbox(q.repo, q.session, before))).toEqual(["note"]);
    expect(kinds(await peekInbox(q.repo, q.session, before))).toEqual(["note"]);
    expect(kinds(await collectInbox(q.repo, q.session))).toEqual(["note"]);
  });

  test("can be read again from the session's opening when no time is given", async () => {
    const q = await ready();
    await postNote(q.repo, q.engine.session, { to: "all", kind: "finding", text: "worth knowing" });
    await collectInbox(q.repo, q.session);

    expect(kinds(await peekInbox(q.repo, q.session))).toEqual(["note"]);
  });

  test("delivers a note that was stamped before the last read and written after it", async () => {
    const q = await ready();
    const read = new Date(Date.now() + 60_000);
    await collectInbox(q.repo, q.session, read);

    await postNote(q.repo, q.engine.session, { to: "all", kind: "finding", text: "stamped early" }, new Date(read.getTime() - 5_000));

    expect(kinds(await collectInbox(q.repo, q.session, new Date(read.getTime() + 1_000)))).toEqual(["note"]);
    expect(await collectInbox(q.repo, q.session, new Date(read.getTime() + 2_000))).toEqual([]);
  });

  test("delivers nothing twice inside that window", async () => {
    const q = await ready();
    const posted = new Date(Date.now() + 60_000);
    await postNote(q.repo, q.engine.session, { to: "all", kind: "finding", text: "once only" }, posted);

    expect(kinds(await collectInbox(q.repo, q.session, new Date(posted.getTime() + 1_000)))).toEqual(["note"]);
    expect(await collectInbox(q.repo, q.session, new Date(posted.getTime() + 2_000))).toEqual([]);
    expect(await collectInbox(q.repo, q.session, new Date(posted.getTime() + 90_000))).toEqual([]);
  });
});
