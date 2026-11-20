import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { activityPath, logActivity } from "../../src/records/activity.ts";
import { appendBuildlog, buildlogPath } from "../../src/records/buildlog.ts";
import { evidencePath, recordEvidence } from "../../src/records/evidence.ts";
import { handoffPath, writeHandoff } from "../../src/records/handoffs.ts";
import { manualPath, recordManual } from "../../src/records/manual.ts";
import { releasesPath } from "../../src/releases/file.ts";
import { markRelease } from "../../src/releases/mark.ts";
import { sh } from "../support/repo.ts";
import { notesPath, postNote, replyNote } from "../../src/records/notes.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { makeTracked } from "../support/tracked.ts";

type Raw = Record<string, unknown>;
type Items = Raw[];

const FUTURE = { kept: "by a later build" };
const NOW = new Date("2026-11-20T10:00:00.000Z");

async function readRaw(path: string): Promise<Raw> {
  return JSON.parse(await readFile(path, "utf8")) as Raw;
}

async function addExtras(path: string, change: (raw: Raw) => Raw): Promise<void> {
  await writeFile(path, `${JSON.stringify(change(await readRaw(path)), null, 2)}\n`);
}

const itemsOf = (raw: Raw, key: string): Items => raw[key] as Items;
const marked = (items: Items): Items => items.map((one) => ({ ...one, future: FUTURE }));

describe("a build keeps the keys it does not know in the records of work", () => {
  it("keeps them on a run record file and a run record", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    const run = { milestone: "B2", task: "4 manifest", kind: "evidence" as const, command: ["make", "check"], cwd: trees["data"]!, started: "2026-11-20T09:00:00Z", seconds: 1, exit: 0 };
    await recordEvidence(repo, data, await new Records(repo).readLedger(), run);
    await addExtras(evidencePath(repo, "B2"), (raw) => ({ ...raw, future: FUTURE, records: marked(itemsOf(raw, "records")) }));

    await recordEvidence(repo, data, await new Records(repo).readLedger(), run);

    const raw = await readRaw(evidencePath(repo, "B2"));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "records")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on a hand-off file and on the note that moves to its history", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    await writeHandoff(repo, data, { lines: ["first"] });
    await addExtras(handoffPath(repo, "data"), (raw) => ({ ...raw, future: FUTURE, current: { ...(raw["current"] as Raw), future: FUTURE } }));

    await writeHandoff(repo, data, { lines: ["second"] });

    const raw = await readRaw(handoffPath(repo, "data"));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "history")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on a context file and an entry that is retired", async () => {
    const { repo } = await makeTracked();
    const { entry } = await putEntry(repo, OPERATOR, { kind: "convention", title: "Errors carry the file", text: "Name the path." }, NOW);
    const path = join(repo.recordsDir, "context", "convention.json");
    await addExtras(path, (raw) => ({ ...raw, future: FUTURE, entries: marked(itemsOf(raw, "entries")) }));

    await retireEntry(repo, OPERATOR, entry.id, "done with it", NOW);

    const raw = await readRaw(path);
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "entries")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the notes file and a note that is replied to", async () => {
    const { repo, root } = await makeTracked();
    const operator = await openSession(repo, { worktree: root, agent: "operator" });
    const note = await postNote(repo, operator, { to: "all", kind: "heads-up", text: "the store moves" }, NOW);
    await addExtras(notesPath(repo), (raw) => ({ ...raw, future: FUTURE, notes: marked(itemsOf(raw, "notes")) }));

    await replyNote(repo, operator, note.id, "it moved", NOW);

    const raw = await readRaw(notesPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "notes")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the build log, a preamble and an entry", async () => {
    const { repo } = await makeTracked();
    const section = { group: "platform", milestone: "B2", title: "the store", date: "2026-11-20", markdown: "Built." };
    await appendBuildlog(repo, section);
    await addExtras(buildlogPath(repo), (raw) => ({
      ...raw,
      future: FUTURE,
      preambles: [{ group: "platform", markdown: "# platform", future: FUTURE }],
      entries: marked(itemsOf(raw, "entries")),
    }));

    await appendBuildlog(repo, { ...section, milestone: "B3", title: "the cache" });

    const raw = await readRaw(buildlogPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "preambles")[0]!["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "entries")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on an activity day and an event", async () => {
    const { repo } = await makeTracked();
    const input = { session: "s-1", track: "data", agent: "claude", verb: "task_claim" };
    await logActivity(repo, input, NOW);
    const path = activityPath(repo, "2026-11-20");
    await addExtras(path, (raw) => ({ ...raw, future: FUTURE, events: marked(itemsOf(raw, "events")) }));

    await logActivity(repo, { ...input, verb: "task_release" }, NOW);

    const raw = await readRaw(path);
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "events")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on a file of checks made by hand and on a check", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    const check = { milestone: "B2", task: "4 manifest", who: "the operator", result: "pass" as const, steps: ["open it"] };
    await recordManual(repo, data, check, NOW);
    await addExtras(manualPath(repo, "B2"), (raw) => ({ ...raw, future: FUTURE, checks: itemsOf(raw, "checks").map((one) => ({ ...one, future: FUTURE, by: { ...(one["by"] as Raw), future: FUTURE } })) }));

    await recordManual(repo, data, check, NOW);

    const raw = await readRaw(manualPath(repo, "B2"));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "checks")[0]!["future"]).toEqual(FUTURE);
    expect((itemsOf(raw, "checks")[0]!["by"] as Raw)["future"]).toEqual(FUTURE);
  });
  it("keeps them on the releases file and on a release", async () => {
    const { repo, root } = await makeTracked();
    const operator = await openSession(repo, { worktree: root, agent: "operator" });
    await markRelease(repo, operator, { version: "1.0.0" }, NOW);
    await addExtras(releasesPath(repo), (raw) => ({ ...raw, future: FUTURE, releases: itemsOf(raw, "releases").map((one) => ({ ...one, future: FUTURE, by: { ...(one["by"] as Raw), future: FUTURE } })) }));
    await sh(root, ["commit", "-q", "--allow-empty", "-m", "chore: next"]);

    await markRelease(repo, operator, { version: "1.0.1" }, NOW);

    const raw = await readRaw(releasesPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "releases")[0]!["future"]).toEqual(FUTURE);
    expect((itemsOf(raw, "releases")[0]!["by"] as Raw)["future"]).toEqual(FUTURE);
  });
});
