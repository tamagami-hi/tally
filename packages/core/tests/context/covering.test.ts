import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { covering } from "../../src/context/covering.ts";
import { putEntry } from "../../src/context/entries.ts";
import { plan } from "../../src/ledger/ops.ts";
import { addDecision } from "../../src/records/decisions.ts";
import { Records } from "../../src/store/records.ts";
import { isPresent } from "../../src/tracks/file.ts";
import { tmpDir } from "../support/tmp.ts";
import { cycling } from "../support/cycling.ts";

async function covered() {
  const made = await cycling();
  const { repo, operator } = made;
  const decide = (id: string, state: "in force" | "built", paths?: string[], status: string = state) => addDecision(repo, { id, group: "core", text: `${id} text`, since: "2026-11-20", status, state }, { operator: true }).then(async () => {
    if (paths === undefined) return;
    const { changeDecisions } = await import("../../src/records/decisions.ts");
    await changeDecisions(repo, (file) => ({ file: { ...file, decisions: file.decisions.map((one) => (one.id === id ? { ...one, paths, accept: [`${id} holds`] } : one)) }, result: undefined }));
  });
  await decide("DEC-1", "in force", ["a.txt"]);
  await decide("DEC-2", "in force", ["src/**"]);
  await decide("DEC-3", "in force");
  await decide("DEC-4", "built");
  await decide("DEC-5", "in force", undefined, "withdrawn: wrong");
  await putEntry(repo, operator, { kind: "rule", title: "Everywhere", text: "applies to every file", section: "working", source: "the operator" });
  await putEntry(repo, operator, { kind: "area", title: "The a file", text: "a.txt is the reader's", paths: ["a.txt"] });
  await putEntry(repo, operator, { kind: "area", title: "The source", text: "src is elsewhere", paths: ["src/**"] });
  return { ...made, range: `${made.landed}~1..${made.landed}` };
}

describe("covering", () => {
  test("answers, for the files a range changes, the decisions and entries whose paths match, the rules first, and how many decisions can never match", async () => {
    const { repo, range } = await covered();

    const answer = await covering(repo, { range });

    expect(answer.files).toEqual(["a.txt"]);
    expect(answer.filesTotal).toBe(1);
    expect(answer.decisions).toEqual([{ id: "DEC-1", state: "in force", text: "DEC-1 text", accept: ["DEC-1 holds"] }]);
    expect(answer.entries.map((one) => [one.id, one.kind])).toEqual([["rule-1", "rule"], ["area-1", "area"]]);
    expect(answer.unplaced).toBe(1);
  });

  test("answers named paths the same way, a folder matching what lies in it", async () => {
    const { repo } = await covered();

    const answer = await covering(repo, { paths: ["src/"] });

    expect(answer.files).toEqual(["src/"]);
    expect(answer.decisions.map((one) => one.id)).toEqual(["DEC-2"]);
    expect(answer.entries.map((one) => one.id)).toEqual(["rule-1", "area-2"]);
  });

  test("needs one of range and paths, never both", async () => {
    const { repo, range } = await covered();

    await expect(covering(repo, {})).rejects.toThrow("covering needs range or paths");
    await expect(covering(repo, { range, paths: ["a.txt"] })).rejects.toThrow("covering takes range or paths, not both");
  });

  test("passes nothing of a range to git as an option, and proves each side a commit first", async () => {
    const { repo } = await covered();
    const spot = join(await tmpDir("tally-spot-"), "x");

    await expect(covering(repo, { range: `--output=${spot}..HEAD` })).rejects.toThrow(`'--output=${spot}' is not a commit`);
    await expect(covering(repo, { range: "-n" })).rejects.toThrow("range is <base>..<head>, two commits; '-n' is not one");
    await expect(covering(repo, { range: "HEAD~1..HEAD..HEAD" })).rejects.toThrow("range is <base>..<head>, two commits; 'HEAD~1..HEAD..HEAD' is not one");
    await expect(covering(repo, { range: "HEAD..no-such-branch" })).rejects.toThrow("'no-such-branch' is not a commit");
    await expect(covering(repo, { range: "HEAD ..HEAD" })).rejects.toThrow("'HEAD ' is not a commit");
    expect(await isPresent(spot)).toBe(false);
  });

  test("takes a path that begins with a dash as a path, never passing it to git", async () => {
    const { repo } = await covered();

    const answer = await covering(repo, { paths: ["-n"] });

    expect(answer.files).toEqual(["-n"]);
    expect(answer.decisions).toEqual([]);
  });

  test("with task, also holds the records the task cites", async () => {
    const { repo, range } = await covered();
    await new Records(repo).update((ledger) => plan(ledger, { milestone: "A2", track: "eng", tasks: [{ id: "3 cite", cites: ["DEC-3"] }] }));

    const answer = await covering(repo, { range, task: "A2:3 cite" });

    expect(answer.cited).toEqual([expect.objectContaining({ id: "DEC-3", text: "DEC-3 text" })]);
  });
});
