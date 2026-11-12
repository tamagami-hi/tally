import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { doneNote, listNotes, postNote, replyNote } from "../../src/records/notes.ts";
import { openSession } from "../../src/state/sessions.ts";
import { makeTracked } from "../support/tracked.ts";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const LATER = new Date("2026-11-12T11:00:00.000Z");

async function two() {
  const tracked = await makeTracked();
  const data = await openSession(tracked.repo, { worktree: tracked.trees["data"] ?? "", agent: "claude" });
  const engine = await openSession(tracked.repo, { worktree: tracked.trees["engine"] ?? "", agent: "kiro" });
  return { ...tracked, data, engine };
}

describe("a note between tracks", () => {
  test("is kept as a record with who wrote it, for whom, and about what", async () => {
    const { repo, root, data } = await two();

    const note = await postNote(repo, data, { to: ["engine"], kind: "heads-up", text: "The store's read path now returns a Result.", about: { paths: ["src/store.rs"] } }, NOW);

    expect(note).toMatchObject({ id: "note-1", from: { track: "data", agent: "claude" }, to: ["engine"], kind: "heads-up", at: NOW.toISOString(), replies: [] });
    expect(JSON.parse(await readFile(join(root, "docs/records/context/notes.json"), "utf8")).notes).toHaveLength(1);
  });

  test("takes the next number each time", async () => {
    const { repo, data, engine } = await two();

    await postNote(repo, data, { to: "all", kind: "finding", text: "one" }, NOW);

    expect((await postNote(repo, engine, { to: "all", kind: "finding", text: "two" }, NOW)).id).toBe("note-2");
  });

  test("is refused for a track that does not exist, or a text that is too long", async () => {
    const { repo, data } = await two();

    await expect(postNote(repo, data, { to: ["nobody"], kind: "request", text: "hello" })).rejects.toThrow("no track 'nobody'; a note goes to all, main, data or engine");
    await expect(postNote(repo, data, { to: "all", kind: "request", text: "x".repeat(601) })).rejects.toThrow("a note is at most 600 characters; this one has 601");
  });

  test("gathers replies and is marked done by its writer or by a track it was for", async () => {
    const { repo, data, engine } = await two();
    const note = await postNote(repo, data, { to: ["engine"], kind: "request", text: "Can you expose the manifest reader?" }, NOW);

    await replyNote(repo, engine, note.id, "Done in my next landing.", LATER);
    const done = await doneNote(repo, engine, note.id, LATER);

    expect(done.replies).toEqual([{ from: { track: "engine", agent: "kiro" }, text: "Done in my next landing.", at: LATER.toISOString() }]);
    expect(done.doneAt).toBe(LATER.toISOString());
  });

  test("lists the open notes for a track, and the done ones when asked", async () => {
    const { repo, data, engine } = await two();
    const forEngine = await postNote(repo, data, { to: ["engine"], kind: "heads-up", text: "for engine" }, NOW);
    await postNote(repo, engine, { to: ["data"], kind: "heads-up", text: "for data" }, NOW);
    const finished = await postNote(repo, data, { to: "all", kind: "finding", text: "finished" }, NOW);
    await doneNote(repo, data, finished.id, LATER);

    expect((await listNotes(repo, { track: "engine" })).map((note) => note.text)).toEqual(["for engine"]);
    expect((await listNotes(repo, { state: "all" })).map((note) => note.text)).toEqual(["for engine", "for data", "finished"]);
    expect((await listNotes(repo, { since: LATER.toISOString(), state: "all" })).map((note) => note.id)).toEqual([finished.id]);
    expect(forEngine.id).toBe("note-1");
  });

  test("cannot be closed by a track it has nothing to do with", async () => {
    const tracked = await makeTracked();
    const data = await openSession(tracked.repo, { worktree: tracked.trees["data"] ?? "", agent: "claude" });
    const engine = await openSession(tracked.repo, { worktree: tracked.trees["engine"] ?? "", agent: "kiro" });
    const operator = await openSession(tracked.repo, { worktree: tracked.root, agent: "operator" });
    const note = await postNote(tracked.repo, data, { to: ["main"], kind: "request", text: "for the operator" }, NOW);

    await expect(doneNote(tracked.repo, engine, note.id)).rejects.toThrow("note-1 is between data and main; engine cannot close it");
    await expect(doneNote(tracked.repo, operator, note.id)).resolves.toMatchObject({ id: "note-1" });
  });
});
