import { describe, expect, test } from "vitest";
import { markRelease } from "../../src/releases/mark.ts";
import { readReleases } from "../../src/releases/file.ts";
import { commitOn } from "../support/landing.ts";
import { AT, releasing } from "../support/releasing.ts";

describe("release_mark", () => {
  test("records a release at main's tip unless told, with who marked it and its notes", async () => {
    const made = await releasing();
    const tip = await made.onMain("src/one.rs", "feat: one");

    const { release } = await markRelease(made.repo, made.operator, { version: "1.0.0", notes: "the first" }, AT);

    expect(release).toEqual({ version: "1.0.0", commit: tip, at: AT.toISOString(), by: { session: made.operator.id, track: "main", agent: "operator" }, notes: "the first" });
    expect((await readReleases(made.repo)).releases).toEqual([release]);
  });

  test("records a version once, and two versions marked at once both", async () => {
    const made = await releasing();
    const tip = await made.onMain("src/one.rs", "feat: one");

    await Promise.all([markRelease(made.repo, made.operator, { version: "1.0.0" }, AT), markRelease(made.repo, made.operator, { version: "1.0.1" }, AT)]);

    await expect(markRelease(made.repo, made.operator, { version: "1.0.0" }, AT)).rejects.toThrow(`release 1.0.0 is already recorded, at ${tip}`);
    expect((await readReleases(made.repo)).releases.map((one) => one.version).sort()).toEqual(["1.0.0", "1.0.1"]);
  });

  test("refuses a version that could leave its place in a path, before anything is read", async () => {
    const made = await releasing();

    for (const version of ["../1.0.0", "1.0/0", "-1.0.0", "1..0", ""]) {
      await expect(markRelease(made.repo, made.operator, { version }, AT)).rejects.toThrow(`'${version}' is not a version: it is letters, digits, '.', '_', '+' and '-', begins with a letter or a digit, and holds no '..'`);
    }
  });

  test("refuses a commit that is not one, and one main does not have", async () => {
    const made = await releasing();
    const aside = (await commitOn(made.trees["data"]!, "src/aside.rs", "feat: aside")).slice(0, 7);

    await expect(markRelease(made.repo, made.operator, { version: "1.0.0", commit: "--all" }, AT)).rejects.toThrow("'--all' is not a commit of");
    await expect(markRelease(made.repo, made.operator, { version: "1.0.0", commit: "nope" }, AT)).rejects.toThrow("'nope' is not a commit of");
    await expect(markRelease(made.repo, made.operator, { version: "1.0.0", commit: aside }, AT)).rejects.toThrow(`${aside} is not on main: a release is marked on a commit main has`);
  });

  test("refuses a release on a commit before the latest release's, since a release's tasks are counted from the one before it", async () => {
    const made = await releasing();
    const first = await made.onMain("src/one.rs", "feat: one");
    const second = await made.onMain("src/two.rs", "feat: two");
    await markRelease(made.repo, made.operator, { version: "1.1.0", commit: second }, AT);

    await expect(markRelease(made.repo, made.operator, { version: "1.0.0", commit: first }, AT)).rejects.toThrow(`1.0.0 at ${first} is before 1.1.0 at ${second}: releases are marked in main's order, each at or after the latest`);
  });

  test("is an operator session's", async () => {
    const made = await releasing();

    await expect(markRelease(made.repo, made.data, { version: "1.0.0" }, AT)).rejects.toThrow("only an operator session marks a release");
  });
});
