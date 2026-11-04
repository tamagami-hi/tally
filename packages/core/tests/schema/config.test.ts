import { describe, expect, test } from "vitest";
import { configSchema } from "../../src/schema/config.ts";

const minimal = {
  schema: 1,
  name: "Example",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "the thin slice", weight: 32 }],
  commands: { test: ["cargo", "test", "--locked"] },
  fingerprint: { paths: ["crates"], exclude: ["*.md"] },
  identity: { name: "tamagami-hi", email: "193059379+tamagami-hi@users.noreply.github.com" },
};

describe("the config schema", () => {
  test("defaults the main branch, the records folder and the commit prefix", () => {
    const config = configSchema.parse(minimal);
    expect(config.mainBranch).toBe("main");
    expect(config.records).toEqual({ dir: "docs/records", commitPrefix: "records:", commit: true });
    expect(config.commands.env).toEqual({});
    expect(config.locks).toEqual(["landing"]);
  });

  test("leaves the landing out unless the config names it, and keeps what it names", () => {
    expect(configSchema.parse(minimal).commands.landing).toBeUndefined();

    const landing = { link: ["node_modules"], env: { CARGO_TARGET_DIR: "{worktree}/target" } };
    const config = configSchema.parse({ ...minimal, commands: { ...minimal.commands, landing } });

    expect(config.commands.landing).toEqual(landing);
    expect(configSchema.parse({ ...minimal, commands: { ...minimal.commands, landing: {} } }).commands.landing).toEqual({});
  });

  test("refuses a landing link that leaves the worktree", () => {
    const linking = (path: string) => ({ ...minimal, commands: { ...minimal.commands, landing: { link: [path] } } });

    expect(() => configSchema.parse(linking("/opt/deps"))).toThrow(/relative to the worktree/);
    expect(() => configSchema.parse(linking("../deps"))).toThrow(/relative to the worktree/);
  });

  test("refuses a stage weight that is not a positive integer", () => {
    const bad = { ...minimal, stages: [{ id: "A", name: "x", weight: 0 }] };
    expect(() => configSchema.parse(bad)).toThrow(/weight/);
  });

  test("refuses two tracks with one name", () => {
    const twice = { ...minimal, tracks: [minimal.tracks[0], minimal.tracks[0]] };
    expect(() => configSchema.parse(twice)).toThrow(/track/);
  });
});
