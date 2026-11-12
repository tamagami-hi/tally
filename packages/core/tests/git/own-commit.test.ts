import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { landTrack } from "../../src/land/run.ts";
import { flushRecords } from "../../src/records/commit.ts";
import { Records } from "../../src/store/records.ts";
import { edit, landingFixture } from "../support/landing.ts";
import { sh } from "../support/repo.ts";

async function failingHook(root: string): Promise<void> {
  const hooks = join(root, ".git", "hooks");
  await mkdir(hooks, { recursive: true });
  await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\necho 'this hook needs a tool the service does not have' >&2\nexit 1\n");
  await chmod(join(hooks, "pre-commit"), 0o755);
}

describe("a commit tally makes itself", () => {
  test("lands a task though the repository's pre-commit hook would fail", async () => {
    const fixture = await landingFixture("true");
    await failingHook(fixture.root);
    await edit(fixture.tree, "src/a.rs");

    const landed = await landTrack(fixture.repo, { track: "data", files: ["src/a.rs"], messageFile: fixture.message }, fixture.deps);

    expect(landed.commits).toHaveLength(1);
    expect(await fixture.main()).toBe(await fixture.head());
  });

  test("commits the records though the hook would fail", async () => {
    const fixture = await landingFixture("true");
    await failingHook(fixture.root);
    const repo = { ...fixture.repo, config: { ...fixture.repo.config, records: { ...fixture.repo.config.records, commit: true } } };
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "a note" }] }, message: "noted" }));

    const sha = await flushRecords(repo);

    expect(sha).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(fixture.root, ["log", "-1", "--format=%s"])).toContain("records:");
  });

  test("is not signed though the repository asks for signed commits", async () => {
    const fixture = await landingFixture("true");
    await sh(fixture.root, ["config", "commit.gpgsign", "true"]);
    await sh(fixture.root, ["config", "gpg.program", "/no/such/gpg"]);
    await edit(fixture.tree, "src/a.rs");

    const landed = await landTrack(fixture.repo, { track: "data", files: ["src/a.rs"], messageFile: fixture.message }, fixture.deps);

    expect(landed.commits).toHaveLength(1);
  });
});
