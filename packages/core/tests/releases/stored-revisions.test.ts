import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitDates } from "../../src/done/dates.ts";
import { checkLedger } from "../../src/ledger/audit.ts";
import { owedCommits } from "../../src/ledger/owed.ts";
import { releasesPath } from "../../src/releases/file.ts";
import { listReleases } from "../../src/releases/list.ts";
import { markRelease } from "../../src/releases/mark.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { endTrial } from "../../src/trials/end.ts";
import { trialsFile } from "../../src/trials/file.ts";
import { startTrial } from "../../src/trials/start.ts";
import { AT, releasing } from "../support/releasing.ts";
import { trialling } from "../support/trialling.ts";

const there = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
const hostile = (root: string): { option: string; file: string } => {
  const file = join(root, ".temp", "written-by-git.txt");
  return { option: `--output=${file}`, file };
};

describe("a revision read back from a record never reaches git as an option", () => {
  test("a release's stored commit is proved first: one that does not prove is that release's problem, and git writes nothing", async () => {
    const made = await releasing();
    const first = await made.onMain("a.txt", "feat: a");
    await markRelease(made.repo, made.operator, { version: "1.0.0", commit: first }, AT);
    const { option, file } = hostile(made.root);
    const stored = JSON.parse(await readFile(releasesPath(made.repo), "utf8")) as { releases: { commit: string }[] };
    await writeFile(releasesPath(made.repo), JSON.stringify({ ...stored, releases: [...stored.releases, { ...stored.releases[0], version: "1.0.1", commit: option }] }));

    const listed = await listReleases(made.repo, {});

    expect(await there(file)).toBe(false);
    expect(listed.releases.map((one) => [one.version, "problem" in one ? one.problem : undefined])).toEqual([["1.0.1", `its commit '${option}' is not a commit of ${made.repo.name}`], ["1.0.0", undefined]]);
  });

  test("the ledger's baseline is proved first: one that does not prove is the ledger's problem, and git writes nothing", async () => {
    const made = await releasing();
    const { option, file } = hostile(made.root);
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, baseline: option }, message: "baseline" }));
    const ledger = await new Records(made.repo).readLedger();

    const owed = await owedCommits(made.repo, ledger);
    const checked = await checkLedger(made.repo, ledger);
    const status = await collect(made.repo, ledger);
    await commitDates(made.repo, option);

    expect(await there(file)).toBe(false);
    expect(owed.problem).toBe(`the ledger's baseline '${option}' is not a commit of ${made.repo.name}, so main is not checked against the ledger; set baseline to the commit the ledger starts from`);
    expect(checked.check.problems).toEqual([owed.problem]);
    expect(status.problems).toContain(owed.problem);
  });

  test("a trial's stored head reaches git only after --end-of-options", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    const { option, file } = hostile(made.root);
    await trialsFile(made.repo).update((trials) => ({ value: { ...trials, trials: trials.trials.map((one) => ({ ...one, head: option })) }, result: undefined }));

    await endTrial(made.repo, made.operator, "both").catch(() => undefined);

    expect([await there(file), await there(`${file}..HEAD`)]).toEqual([false, false]);
  });
});
