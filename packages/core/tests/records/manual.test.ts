import { mkdir, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listManual, readManual, recordManual } from "../../src/records/manual.ts";
import { AT, cycling } from "../support/cycling.ts";

const CHECK = { milestone: "A1", task: "1 read", who: "the operator, on a phone", result: "pass" as const, steps: ["open the app", "read a file"], device: "a phone", build: "0.9.0-rc1" };

async function withFile(name: string, text = "a screenshot\n") {
  const made = await cycling();
  const folder = join(made.root, ".temp", "shots");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, name), text);
  return { ...made, file: join(folder, name) };
}

describe("evidence_manual", () => {
  test("records a check made by hand with the session that wrote it, and an attachment by path, hash and size", async () => {
    const { repo, operator, file } = await withFile("shot.png");

    const { check } = await recordManual(repo, operator, { ...CHECK, attachments: [file] }, AT);

    expect(check).toMatchObject({ id: "manual-1", task: "1 read", who: CHECK.who, result: "pass", steps: CHECK.steps, device: "a phone", build: "0.9.0-rc1", by: { session: operator.id, track: "main", agent: "operator" }, at: AT.toISOString() });
    expect(check.attachments).toEqual([{ path: file, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 13 }]);
    expect((await readManual(repo, "A1")).checks).toHaveLength(1);
  });

  test("gives two checks recorded at once two ids, and keeps both", async () => {
    const { repo, operator } = await cycling();

    const [first, second] = await Promise.all([recordManual(repo, operator, CHECK, AT), recordManual(repo, operator, { ...CHECK, result: "fail" }, AT)]);

    expect(new Set([first.check.id, second.check.id])).toEqual(new Set(["manual-1", "manual-2"]));
    expect((await listManual(repo, "A1")).map((one) => one.result).sort()).toEqual(["fail", "pass"]);
  });

  test("refuses an attachment outside the repository's .temp/: a path that climbs, one elsewhere, and a link that points out", async () => {
    const { repo, operator, root } = await withFile("shot.png");
    await symlink("/etc/hostname", join(root, ".temp", "shots", "out.png"));

    for (const outside of ["../../../etc/hostname", "/etc/hostname", join(root, ".temp", "shots", "out.png"), join(root, "a.txt")]) {
      await expect(recordManual(repo, operator, { ...CHECK, attachments: [outside] }, AT)).rejects.toThrow("an attachment must be a file under the repository's .temp/");
    }
    expect((await readManual(repo, "A1")).checks).toEqual([]);
  });

  test("refuses an attachment over the limit, saying its size, before reading it", async () => {
    const { repo, operator, file } = await withFile("film.mp4");
    await truncate(file, 201 * 1024 * 1024);

    await expect(recordManual(repo, operator, { ...CHECK, attachments: [file] }, AT)).rejects.toThrow("an attachment holds at most 200 MB; this one has 201 MB");
  });

  test("keeps steps to 1 to 30 lines, a result of pass or fail, and a task the ledger has", async () => {
    const { repo, operator } = await cycling();

    await expect(recordManual(repo, operator, { ...CHECK, steps: [] }, AT)).rejects.toThrow("steps holds 1 to 30 lines; this one has 0");
    await expect(recordManual(repo, operator, { ...CHECK, steps: Array.from({ length: 31 }, () => "x") }, AT)).rejects.toThrow("steps holds 1 to 30 lines; this one has 31");
    await expect(recordManual(repo, operator, { ...CHECK, task: "9 none" }, AT)).rejects.toThrow("'9 none' is not planned in A1");
  });
});
