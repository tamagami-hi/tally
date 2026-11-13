import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { configureRepo } from "../../src/repos/configure.ts";
import { openRepo } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked, trackedConfig } from "../support/tracked.ts";

const DATA = { track: "data", agent: "claude" };
const OPERATOR = { track: "main", agent: "operator" };

const onDisk = async (root: string): Promise<string> => readFile(join(root, "docs/records/config.json"), "utf8");

describe("changing a repository's config through a tool", () => {
  test("a top-level key replaces what was there, and the rest is kept", async () => {
    const { repo, root } = await makeTracked();

    const { config, changed } = await configureRepo(repo, OPERATOR, { locks: ["landing", "gpu"], context: "records", stages: [{ id: "B", name: "widen", weight: 2 }, { id: "C", name: "harden", weight: 1 }] });

    expect(changed).toEqual(["locks", "context", "stages"]);
    expect(config).toEqual({ ...trackedConfig, locks: ["landing", "gpu"], context: "records", stages: [{ id: "B", name: "widen", weight: 2 }, { id: "C", name: "harden", weight: 1 }] });
    expect(JSON.parse(await onDisk(root))).toEqual(config);
    expect((await openRepo(root)).config).toEqual(config);
  });

  test("commands merges one level deep: a key that was not given stays", async () => {
    const { repo } = await makeTracked();
    await configureRepo(repo, OPERATOR, { commands: { tmpdir: ".temp/{track}/tmp", env: { CI: "1", TZ: "UTC" } } });

    const { config } = await configureRepo(repo, OPERATOR, { commands: { test: ["npm", "test"], env: { CI: "2" } } });

    expect(config.commands).toEqual({ test: ["npm", "test"], env: { CI: "2" }, unset: [], tmpdir: ".temp/{track}/tmp" });
  });

  test("keeps what the file holds that this build does not know, and adds no default the file left out", async () => {
    const { repo, root } = await makeTracked();
    const { mainBranch: _left, ...written } = JSON.parse(await onDisk(root)) as Record<string, unknown>;
    await writeFile(join(root, "docs/records/config.json"), JSON.stringify({ ...written, fromALaterBuild: { kept: true } }));

    const { config } = await configureRepo(repo, OPERATOR, { locks: ["landing"] });

    expect(JSON.parse(await onDisk(root))).toEqual({ ...written, fromALaterBuild: { kept: true }, locks: ["landing"] });
    expect(config).toEqual({ ...trackedConfig, locks: ["landing"] });
  });

  test("refuses a key the schema would drop, at any depth, and writes nothing", async () => {
    const { repo, root } = await makeTracked();
    const before = await onDisk(root);

    await expect(configureRepo(repo, OPERATOR, { colour: "green" })).rejects.toThrow(/^the config has no place for 'colour'; nothing was written\. Its keys: schema, name, mainBranch, /);
    await expect(configureRepo(repo, OPERATOR, { commands: { shout: ["echo"] }, fingerprint: { paths: ["."], exlude: [] }, tracks: [{ name: "data", worktree: "w", branch: "b", colour: "red" }] })).rejects.toThrow("the config has no place for 'commands.shout', 'fingerprint.exlude', 'tracks[0].colour'; nothing was written");
    await expect(configureRepo(repo, OPERATOR, { toString: "x", commands: { constructor: {} } })).rejects.toThrow("the config has no place for 'toString', 'commands.constructor'; nothing was written");
    await expect(configureRepo(repo, OPERATOR, JSON.parse('{"__proto__": {"colour": "green"}}') as Record<string, unknown>)).rejects.toThrow("the config has no place for '__proto__'; nothing was written");
    expect(await onDisk(root)).toBe(before);
    expect(({} as Record<string, unknown>)["colour"]).toBeUndefined();
  });

  test("refuses a config that would not fit its schema, saying where, and a call that gives nothing", async () => {
    const { repo, root } = await makeTracked();
    const before = await onDisk(root);

    await expect(configureRepo(repo, OPERATOR, { stages: [{ id: "A", name: "a", weight: 0 }] })).rejects.toThrow(/^the config would not fit its schema, so nothing was written:\n  stages\.0\.weight: /);
    await expect(configureRepo(repo, OPERATOR, { commands: "npm test" })).rejects.toThrow(/\n  commands: /);
    await expect(configureRepo(repo, OPERATOR, {})).rejects.toThrow("changing the config needs at least one of its keys");
    expect(await onDisk(root)).toBe(before);
  });

  test("is refused to a track's session", async () => {
    const { repo, root } = await makeTracked();
    const before = await onDisk(root);

    await expect(configureRepo(repo, DATA, { locks: ["landing"] })).rejects.toThrow("only an operator session changes the config; a track that wants a change asks a question with question_add");
    expect(await onDisk(root)).toBe(before);
  });

  test("is a records commit where the config commits", async () => {
    const { repo, root } = await makeTracked({ commit: true });

    const { commit } = await configureRepo(repo, OPERATOR, { locks: ["landing"], context: "records" });

    expect(commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: config changed by operator: locks, context");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("takes a worktreeRoot under .temp/, where git ignores it", async () => {
    const { repo, root } = await makeTracked();

    for (const worktreeRoot of [".temp", ".temp/lanes", ".temp/a/b"]) {
      const { config } = await configureRepo(repo, OPERATOR, { worktreeRoot });
      expect(config.worktreeRoot).toBe(worktreeRoot);
    }
    expect(JSON.parse(await onDisk(root)).worktreeRoot).toBe(".temp/a/b");
  });

  test("refuses a worktreeRoot that is not .temp or under it, and writes nothing", async () => {
    const { repo, root } = await makeTracked();
    const before = await onDisk(root);

    for (const worktreeRoot of ["lanes", "../x", ".temper", "docs/.temp", "/abs/.temp"]) {
      await expect(configureRepo(repo, OPERATOR, { worktreeRoot })).rejects.toThrow(`worktrees live under .temp/, which git ignores; '${worktreeRoot}' is not`);
    }
    expect(await onDisk(root)).toBe(before);
  });

  test("still reads a config that already holds another worktreeRoot, and changes its other keys", async () => {
    const { repo, root } = await makeTracked();
    const written = JSON.parse(await onDisk(root)) as Record<string, unknown>;
    await writeFile(join(root, "docs/records/config.json"), JSON.stringify({ ...written, worktreeRoot: "lanes" }));

    const { config } = await configureRepo(repo, OPERATOR, { locks: ["landing", "gpu"] });

    expect(config.worktreeRoot).toBe("lanes");
    expect((await openRepo(root)).config.worktreeRoot).toBe("lanes");
  });
});
