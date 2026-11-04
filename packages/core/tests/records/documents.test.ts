import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { documentsPath, documentsFileSchema, initRecords, listDocs, openRepo, readDoc, readJson, scanDocuments, type Config } from "../../src/index.ts";
import { makeRepo, sh } from "../support/repo.ts";

const config: Config = {
  schema: 1, name: "Test", mainBranch: "main", docsDir: "docs", tracks: [], stages: [],
  commands: { test: ["true"], env: {}, unset: [] }, fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "t", email: "t@example.com" }, records: { dir: "docs/records", commitPrefix: "records:", commit: true }, locks: ["landing"],
  extraDocs: ["tools/README.md", "tools/absent.md"],
};

const FILES: Record<string, string> = {
  "docs/README.md": "# docs\n\n| document | what it is for |\n| --- | --- |\n| [the plan](alpha/next/plan.md) | **The plan,** in short. |\n| [outside](../tools/README.md) | How the tools work. |\n",
  "docs/alpha/README.md": "# Alpha\n\n| document | what it covers |\n| --- | --- |\n| [fees](reference/fees.md#table) | The fee table. |\n| [the plan](next/plan.md) | Ignored: the first index wins. |\n",
  "docs/alpha/next/plan.md": "# A plan\n\n**Status: decided.** Text.\n",
  "docs/alpha/completed/old/done.md": "# Done\n",
  "docs/alpha/reference/fees.md": "# Fees\n",
  "docs/alpha/reports/2026-01-01/run.md": "# A run\n",
  "docs/alpha/decisions.md": "# Alpha: decisions\n\n**How it is kept.** Only the operator.\n\n| a | b |\n| --- | --- |\n| map | row |\n\n## 1. First\n\n| id | decision |\n| --- | --- |\n| A-1 | x |\n",
  "docs/alpha/questions.md": "# Alpha: questions\n\n**Collected.** Answered on 2026-01-01: row 1 (A-1).\n\n| # | question | meanwhile |\n| --- | --- | --- |\n| 2 | Why? | Wait. |\n",
  "docs/alpha/build-log.md": "# Alpha: build log\n\nIntro.\n\n## One\n",
  "docs/manual/run.md": "# Running it\n",
  "docs/map.md": "# The map\n",
  "tools/README.md": "# Tools\n",
  "src/notes.md": "# Not a document\n",
};

async function fixture() {
  const repo = await makeRepo();
  await repo.commit(".gitignore", ".temp/\n", "chore: ignore");
  await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(repo.root, path)), { recursive: true });
    await writeFile(join(repo.root, path), text);
  }
  await sh(repo.root, ["add", "-A"]);
  await sh(repo.root, ["commit", "-q", "-m", "docs: all"]);
  return openRepo(repo.root);
}

async function scanned() {
  const repo = await fixture();
  const done = await scanDocuments(repo);
  const { documents } = await readJson(documentsPath(repo), documentsFileSchema);
  return { repo, done, byPath: new Map(documents.map((d) => [d.path, d])), paths: documents.map((d) => d.path) };
}

describe("the documents record", () => {
  test("holds every Markdown document with its kind, group and title, sorted", async () => {
    const { byPath, paths, done } = await scanned();
    expect(paths).toEqual([...paths].sort());
    expect(byPath.get("docs/alpha/next/plan.md")).toMatchObject({ kind: "next", group: "alpha", title: "A plan" });
    expect(byPath.get("docs/alpha/completed/old/done.md")?.kind).toBe("completed");
    expect(byPath.get("docs/alpha/reference/fees.md")?.kind).toBe("reference");
    expect(byPath.get("docs/alpha/reports/2026-01-01/run.md")?.kind).toBe("report");
    expect(byPath.get("docs/manual/run.md")).toMatchObject({ kind: "manual", group: "manual" });
    expect(byPath.get("docs/alpha/README.md")?.kind).toBe("front");
    expect(byPath.get("docs/alpha/build-log.md")?.kind).toBe("record");
    expect(byPath.get("docs/map.md")?.kind).toBe("other");
    expect(byPath.has("src/notes.md")).toBe(false);
    expect(done.documents).toBe(paths.length);
    expect(done.commit).not.toBeNull();
  });

  test("takes each document's purpose from the first index that lists it, through relative links and anchors", async () => {
    const { byPath } = await scanned();
    expect(byPath.get("docs/alpha/next/plan.md")?.purpose).toBe("**The plan,** in short.");
    expect(byPath.get("docs/alpha/reference/fees.md")?.purpose).toBe("The fee table.");
    expect(byPath.get("tools/README.md")?.purpose).toBe("How the tools work.");
    expect(byPath.get("docs/manual/run.md")?.purpose).toBeUndefined();
  });

  test("keeps the prose above a decisions or questions file's own rows, which their records do not hold", async () => {
    const { byPath } = await scanned();
    const decisions = byPath.get("docs/alpha/decisions.md")?.preamble;
    expect(decisions).toContain("**How it is kept.** Only the operator.");
    expect(decisions).toContain("| map | row |");
    expect(decisions).not.toContain("A-1 | x");
    const questions = byPath.get("docs/alpha/questions.md")?.preamble;
    expect(questions).toBe("**Collected.** Answered on 2026-01-01: row 1 (A-1).");
    expect(byPath.get("docs/alpha/build-log.md")?.preamble).toBeUndefined();
  });
});

describe("documents outside the docs folder", () => {
  test("are listed and read when the config names them, and only then", async () => {
    const repo = await fixture();
    const listed = await listDocs(repo);
    expect(listed).toContain("tools/README.md");
    expect(listed).not.toContain("tools/absent.md");
    expect((await readDoc(repo, "tools/README.md")).text).toBe("# Tools\n");
    await expect(readDoc(repo, "src/notes.md")).rejects.toThrow("not a document");
  });
});
