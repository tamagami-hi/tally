import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { landTrack, type LandDeps } from "../../src/land/run.ts";
import { branches } from "../../src/status/tracks.ts";
import { commitOn, edit, landingFixture } from "../support/landing.ts";
import { sh } from "../support/repo.ts";

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

describe("a landing in a clean checkout", () => {
  test("a commit that needs an uncommitted file fails, leaving that file and the staged work as they were", async () => {
    const f = await landingFixture("test -f src/helper.rs");
    await edit(f.tree, "src/user.rs", "use helper;\n");
    await edit(f.tree, "src/helper.rs", "fn helper() {}\n");
    const main = await f.main();

    const landing = landTrack(f.repo, { track: "data", files: ["src/user.rs"], messageFile: f.message }, f.deps);

    await expect(landing).rejects.toThrow(`feat(data): the task failed: sh -c`);
    await expect(landing).rejects.toThrow(`the log is ${f.log}`);
    await expect(landing).rejects.toThrow("is undone, and its files stay staged");
    expect(await f.main()).toBe(main);
    expect(await f.head()).toBe(main);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("A  src/user.rs\n?? src/helper.rs");
    expect(await readFile(join(f.tree, "src", "user.rs"), "utf8")).toBe("use helper;\n");
    expect(await readFile(join(f.tree, "src", "helper.rs"), "utf8")).toBe("fn helper() {}\n");
    expect(await readFile(f.log, "utf8")).toContain("feat(data): the task");
  });

  test("the staged work lands once the file it needs is named too", async () => {
    const f = await landingFixture("test -f src/helper.rs");
    await edit(f.tree, "src/user.rs");
    await edit(f.tree, "src/helper.rs");
    await expect(landTrack(f.repo, { track: "data", files: ["src/user.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("failed");

    await landTrack(f.repo, { track: "data", files: ["src/user.rs", "src/helper.rs"], messageFile: f.message }, f.deps);

    expect(await sh(f.root, ["show", "--format=%s", "--name-only", "main"])).toBe("feat(data): the task\n\nsrc/helper.rs\nsrc/user.rs");
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("");
  });

  test("a lint-style failure in an unrelated uncommitted file does not fail it, and the drafts stay", async () => {
    const f = await landingFixture("! grep -rq LINT_ERROR src");
    await edit(f.tree, "src/draft.rs", "LINT_ERROR\n");
    await edit(f.tree, "src/lib.rs", "fn a() {} \n");
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await sh(f.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("M src/lib.rs\n?? src/draft.rs");
    expect(await readFile(join(f.tree, "src", "draft.rs"), "utf8")).toBe("LINT_ERROR\n");
  });

  test("a whitespace error in a file that lands still refuses it, with nothing committed", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/lib.rs", "fn a() {} \n");
    const main = await f.main();

    await expect(landTrack(f.repo, { track: "data", files: ["src/lib.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("trailing whitespace");

    expect(await f.head()).toBe(main);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("M src/lib.rs");
    expect(await f.runs()).toEqual([]);
  });

  test("a middle commit of three failing stops it, names that commit and leaves main where it was", async () => {
    const f = await landingFixture("test ! -e src/broken");
    const one = await commitOn(f.tree, "src/one.rs", "feat: one");
    const two = await commitOn(f.tree, "src/broken", "feat: two");
    await sh(f.tree, ["rm", "-q", "src/broken"]);
    await sh(f.tree, ["commit", "-q", "-m", "feat: three"]);
    const tip = await f.head();
    const main = await f.main();

    const landing = landTrack(f.repo, { track: "data", files: [] }, f.deps);

    await expect(landing).rejects.toThrow(`${two.slice(0, 7)} feat: two failed:`);
    expect(await f.main()).toBe(main);
    expect(await f.head()).toBe(tip);
    expect(await f.runs()).toEqual([`${one} feat: one`, `${two} feat: two`]);
  });

  test("tests every commit, oldest first, when all pass, and main takes them all", async () => {
    const f = await landingFixture("true");
    const one = await commitOn(f.tree, "src/one.rs", "feat: one");
    const two = await commitOn(f.tree, "src/two.rs", "feat: two");
    await edit(f.tree, "src/three.rs");

    const landed = await landTrack(f.repo, { track: "data", files: ["src/three.rs"], messageFile: f.message }, f.deps);

    const three = await f.main();
    expect(await f.runs()).toEqual([`${one} feat: one`, `${two} feat: two`, `${three} feat(data): the task`]);
    expect(landed.commits).toEqual([one, two, three].map((sha) => sha.slice(0, 7)));
    expect(landed.head).toBe(three.slice(0, 7));
  });

  test("success fast-forwards main with the very commit that was tested, as the operator", async () => {
    const f = await landingFixture("pwd > ../where");
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await f.main()).toBe(await f.head());
    expect(await f.runs()).toEqual([`${await f.main()} feat(data): the task`]);
    expect((await readFile(join(f.checkout, "..", "where"), "utf8")).trim()).toBe(await realpath(f.checkout));
    expect(await sh(f.root, ["log", "-1", "--format=%an <%ae>|%cn|%B", "main"])).toBe("operator <operator@example.com>|operator|feat(data): the task\n\nwhy it is so");
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("");
    expect(await sh(f.tree, ["branch", "--show-current"])).toBe("track/data");
  });

  test("tests a commit on top of a main that moved, as the rebase left it", async () => {
    const f = await landingFixture("test -f src/from-main.rs");
    await commitOn(f.root, "src/from-main.rs", "feat: from main");
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await sh(f.root, ["log", "-2", "--format=%s", "main"])).toBe("feat(data): the task\nfeat: from main");
  });

  test("link and env reach the test command, past the repository's unset", async () => {
    const script = 'test -f deps/tool && printf "%s %s\\n" "$CARGO_TARGET_DIR" "$MARK" > ../env';
    const f = await landingFixture(script, { link: ["deps"], env: { CARGO_TARGET_DIR: "{worktree}/target", MARK: "{track}-{track}" } });
    await edit(f.tree, "deps/tool", "kept\n");
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await readFile(join(f.checkout, "..", "env"), "utf8")).toBe(`${f.tree}/target data-data\n`);
    expect(await readFile(join(f.tree, "deps", "tool"), "utf8")).toBe("kept\n");
  });

  test("keeps the landing environment: the configured values, and TMPDIR in the worktree", async () => {
    const f = await landingFixture('printf "%s\\n" "$TMPDIR" > ../tmp-seen');
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await readFile(join(f.checkout, "..", "tmp-seen"), "utf8")).toBe(`${join(f.tree, ".temp", "data", "tmp")}\n`);
  });

  test("a second landing reuses the checkout, with nothing left of the first run but what is ignored", async () => {
    const f = await landingFixture("test ! -e junk.txt && touch junk.txt && mkdir -p .temp && echo run >> .temp/kept");
    await edit(f.tree, "src/one.rs");
    await landTrack(f.repo, { track: "data", files: ["src/one.rs"], messageFile: f.message }, f.deps);
    const listed = await sh(f.root, ["worktree", "list", "--porcelain"]);
    await edit(f.tree, "src/two.rs");

    await landTrack(f.repo, { track: "data", files: ["src/two.rs"], messageFile: f.message }, f.deps);

    expect(await readFile(join(f.checkout, ".temp", "kept"), "utf8")).toBe("run\nrun\n");
    const places = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("worktree "));
    expect(places(await sh(f.root, ["worktree", "list", "--porcelain"]))).toEqual(places(listed));
  });

  test("leaves the checkout off the board after it ran", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");

    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);

    expect(await exists(f.checkout)).toBe(true);
    expect((await branches(f.root, "main")).map((row) => [row.branch, row.dirty])).toEqual([["main", 0], ["track/data", 0]]);
  });

  test("a track's own test command runs there, and its paths still bind", async () => {
    const f = await landingFixture("exit 1");
    const own = { ...f.repo, config: { ...f.repo.config, tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data", test: ["sh", "-c", "test -f ui/page.tsx"], paths: ["ui"] }] } };
    await edit(f.tree, "ui/page.tsx");
    await edit(f.tree, "src/new.rs");

    await expect(landTrack(own, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("data lands only ui: src/new.rs is outside them");
    await landTrack(own, { track: "data", files: ["ui/page.tsx"], messageFile: f.message }, f.deps);

    expect(await sh(f.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
  });

  test("with nothing ahead of main it tests nothing and lands nothing", async () => {
    const f = await landingFixture("exit 1");

    const landed = await landTrack(f.repo, { track: "data", files: [] }, f.deps);

    expect(landed.commits).toEqual([]);
    expect(await exists(f.checkout)).toBe(false);
  });

  test("a verified-code landing reuses its verification and needs no checkout", async () => {
    const f = await landingFixture("exit 1");
    await commitOn(f.tree, "docs/note.md", "docs: note");
    const fingerprint = await sh(f.root, ["log", "-1", "--format=%h", "--", "src", ":(exclude)*.md"]);
    await edit(f.tree, "docs/two.md");

    await landTrack(f.repo, { track: "data", files: ["docs/two.md"], messageFile: f.message, verifiedCode: fingerprint }, f.deps);

    expect(await f.runs()).toEqual([]);
    expect(await exists(f.checkout)).toBe(false);
    expect(await sh(f.root, ["log", "-2", "--format=%s", "main"])).toBe("feat(data): the task\ndocs: note");
  });
});

describe("a track that keeps working while it lands", () => {
  test("main takes what was tested and not the commit made during the tests", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    const working: LandDeps = {
      ...f.deps,
      runTests: async (cwd, command, env, label) => {
        await f.deps.runTests(cwd, command, env, label);
        await commitOn(f.tree, "src/later.rs", "feat: later");
      },
    };

    const landed = await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, working);

    expect(await sh(f.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    expect(landed.commits).toHaveLength(1);
    expect(await sh(f.tree, ["log", "--format=%s", "main..HEAD"])).toBe("feat: later");
  });

  test("a failure leaves a commit made during the tests where it is, and says the landing's stays under it", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    const working: LandDeps = {
      ...f.deps,
      runTests: async () => {
        await commitOn(f.tree, "src/later.rs", "feat: later");
        throw new Error("tests failed");
      },
    };

    const landing = landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, working);

    await expect(landing).rejects.toThrow("the branch moved on, so");
    expect(await sh(f.tree, ["log", "-2", "--format=%s"])).toBe("feat: later\nfeat(data): the task");
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("");
  });
});

describe("a clean landing that fails after its commit", () => {
  test("main moving undoes the commit, unlike a landing in the worktree", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    const before = await f.head();
    const deps: LandDeps = { ...f.deps, afterTests: async () => { await sh(f.root, ["commit", "-q", "--allow-empty", "-m", "someone else"]); } };

    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, deps)).rejects.toThrow("main moved outside the landing lock; task preserved, retry");

    expect(await f.head()).toBe(before);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("A  src/new.rs");
  });

  test("a link it cannot lay undoes it", async () => {
    const f = await landingFixture("true", { link: ["deps"] });
    await edit(f.tree, "src/new.rs");
    const before = await f.head();

    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("the landing cannot link deps: the worktree has none");

    expect(await f.head()).toBe(before);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("A  src/new.rs");
  });

  test("a folder in the checkout's place undoes it, and the worktree's drafts are not touched", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    await edit(f.tree, "src/lib.rs", "fn draft() {}\n");
    await edit(f.checkout, "notes.txt", "mine\n");
    const before = await f.head();

    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("already exists");

    expect(await f.head()).toBe(before);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("M src/lib.rs\nA  src/new.rs");
    expect(await readFile(join(f.checkout, "notes.txt"), "utf8")).toBe("mine\n");
  });

  test("a commit it cannot undo is named, with the failure that came first", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    const lock = join(f.root, ".git", "refs", "heads", "track", "data.lock");
    const stuck: LandDeps = { ...f.deps, runTests: async () => { await writeFile(lock, ""); throw new Error("tests failed"); } };

    const landing = landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, stuck);

    await expect(landing).rejects.toThrow("tests failed");
    await expect(landing).rejects.toThrow("could not be undone");
  });
});

describe("a landing with commands.landing absent", () => {
  test("still tests the worktree before committing, so it sees uncommitted files and makes no checkout", async () => {
    const f = await landingFixture("test -f src/helper.rs && pwd > ../where", null);
    await edit(f.tree, "src/user.rs");
    await edit(f.tree, "src/helper.rs");
    await sh(f.tree, ["add", "src/user.rs"]);
    const tested: string[] = [];
    const deps: LandDeps = {
      ...f.deps,
      runTests: async (cwd, command, env) => {
        tested.push(await sh(cwd, ["log", "-1", "--format=%s"]));
        await f.deps.runTests(cwd, command, env);
      },
    };

    await landTrack(f.repo, { track: "data", files: ["src/user.rs"], messageFile: f.message }, deps);

    expect(tested).toEqual(["records: init"]);
    expect((await readFile(join(f.tree, "..", "where"), "utf8")).trim()).toBe(await realpath(f.tree));
    expect(await exists(f.checkout)).toBe(false);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("?? src/helper.rs");
  });

  test("still runs its whitespace check on every uncommitted file", async () => {
    const f = await landingFixture("true", null);
    await edit(f.tree, "src/lib.rs", "fn a() {} \n");
    await edit(f.tree, "src/new.rs");

    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("trailing whitespace");
  });

  test("still tests only the tip of commits it did not make", async () => {
    const f = await landingFixture("true", null);
    await commitOn(f.tree, "src/one.rs", "feat: one");
    const two = await commitOn(f.tree, "src/two.rs", "feat: two");

    await landTrack(f.repo, { track: "data", files: [] }, f.deps);

    expect(await f.runs()).toEqual([`${two} feat: two`]);
  });
});
