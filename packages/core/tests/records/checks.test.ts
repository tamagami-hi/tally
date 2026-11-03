import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checksFingerprint, importChecks, parseChecks, readChecks, renderChecks, setChecks } from "../../src/records/checks.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";
import { CHECKS } from "../fixtures/records.ts";

describe("the code-check record", () => {
  test("parses the fingerprint, the checks, the suites and each module, and renders back byte for byte", () => {
    const record = parseChecks(CHECKS);
    expect(record.fingerprint).toBe("58b59d3");
    expect(record.fingerprintFull).toBe("58b59d32dc5749cccb8febb27b0c96a6f75115cb");
    expect(record.verifiedBy).toBe("One sweep at a03496a.");
    expect(record.recorded).toBe("2026-11-03, B4 DATA part only.");
    expect(record.command).toBe("git log -1 --format=%h -- crates ':(exclude)*.md'");
    expect(record.checks).toEqual([{ name: "Formatting", result: "pass" }, { name: "`cargo test --locked`", result: "**1073 passed**, 0 failed, 0 ignored" }]);
    expect(record.suites).toEqual([{ name: "`acme-core` unit", where: "`tests/unit/core/`", tests: "699", count: 699 }, { name: "Dashboard (Vitest)", where: "`ui/tests/`", tests: "76 in 21 files", count: 76 }]);
    expect(record.modules.map((m) => m.name)).toEqual(["`acme-core::archive`: reading the recorder's files (A1)", "`ui/`: the dashboard (A7)"]);
    const archive = record.modules[0]!;
    expect(archive.files.map((f) => [f.path, f.lines])).toEqual([["archive/chain/axes.rs", 113], ["archive/mod.rs", 14], ["archive/key.rs", 336]]);
    expect(archive.files[0]?.tests).toBe("`core/archive/chain/axes.rs` 5");
    expect(archive.tests).toEqual(["core/archive/chain/axes.rs", "core/registry/key.rs", "core/registry/golden.rs"]);
    expect(archive.entryPoints).toEqual(["`acme_core::archive::open`."]);
    expect(archive.gaps).toEqual(["Weakest files: `writer.rs`: 8 of its 18 functions are never run.", "Open: the persisted store is still B2."]);
    expect(archive.notes).toEqual([{ label: "Does", text: "framing and streaming zstd; a cell `a | b` inside code." }]);
    expect(record.modules[1]?.files[0]?.tests).toBeUndefined();
    expect(record.modules[1]?.notes).toEqual([{ label: "Does (A7)", text: "sign-in." }]);
    expect(renderChecks(record)).toBe(CHECKS);
  });

  test("import refuses a lossy read and a file with no fingerprint, and writes the record otherwise", async () => {
    const { repo, root } = await makeTracked();
    expect(await readChecks(repo)).toBeNull();
    await writeFile(join(root, "bad.md"), CHECKS.replace("| Formatting | pass |", "|Formatting|pass|"));
    await expect(importChecks(repo, join(root, "bad.md"))).rejects.toThrow(/does not render back as it is/);
    await writeFile(join(root, "none.md"), CHECKS.replace("**Code fingerprint**", "**Fingerprint**"));
    await expect(importChecks(repo, join(root, "none.md"))).rejects.toThrow(/no Code fingerprint row/);
    await writeFile(join(root, "checks.md"), CHECKS);
    const done = await importChecks(repo, join(root, "checks.md"));
    expect(done).toMatchObject({ fingerprint: "58b59d3", checks: 2, suites: 2, modules: 2, files: 4, commit: null });
    expect((await readChecks(repo))?.modules.length).toBe(2);
  });

  test("fingerprint says whether the record stands against main, and set refuses a fingerprint main does not print", async () => {
    const { repo, root } = await makeTracked();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.rs"), "a");
    await sh(root, ["add", "src/a.rs"]);
    await sh(root, ["commit", "-q", "-m", "feat: a"]);
    const atMain = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    const stale = parseChecks(CHECKS);
    await expect(setChecks(repo, stale)).rejects.toThrow(`the record's fingerprint 58b59d3 is not what git log prints for the config's paths at main (${atMain})`);
    const current = parseChecks(CHECKS.replaceAll("58b59d3", atMain));
    expect(await setChecks(repo, current)).toMatchObject({ fingerprint: atMain, commit: null });
    expect(await checksFingerprint(repo)).toEqual({ record: atMain, main: atMain, stands: true });
    await writeFile(join(root, "src", "b.rs"), "b");
    await sh(root, ["add", "src/b.rs"]);
    await sh(root, ["commit", "-q", "-m", "feat: b"]);
    const moved = await checksFingerprint(repo);
    expect(moved.stands).toBe(false);
    expect(moved.main).toBe(await sh(root, ["rev-parse", "--short=7", "HEAD"]));
    await writeFile(join(root, "docs", "note.md"), "docs only");
    await sh(root, ["add", "docs/note.md"]);
    await sh(root, ["commit", "-q", "-m", "docs: note"]);
    expect((await checksFingerprint(repo)).main).toBe(moved.main);
  });
});
