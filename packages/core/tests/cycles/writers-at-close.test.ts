import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleDir } from "../../src/cycles/file.ts";
import { recordEvidence } from "../../src/records/evidence.ts";
import { recordManual } from "../../src/records/manual.ts";
import { Records } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT, delay } from "../support/pending.ts";

const CHECK = { milestone: "A1", task: "1 read", who: "the operator", result: "pass" as const, steps: ["open the app"] };
const ATTACHMENT_BYTES = 120 * 1024 * 1024;
const LOG_LINES = 600_000;
const DELAYS = [0, 40, 150, 500];

const read = (path: string): Promise<{ id: string }[] | undefined> => readFile(path, "utf8").then((text) => {
  const file = JSON.parse(text) as { checks?: { id: string }[]; records?: { id: string }[] };
  return file.checks ?? file.records ?? [];
}, () => undefined);

interface Ended {
  manual: PromiseSettledResult<{ check: { id: string } }>;
  run: PromiseSettledResult<{ record: { id: string } }>;
}

async function racing(hadFiles: boolean, wait: number) {
  const made = await cycling();
  if (hadFiles) await recordManual(made.repo, made.operator, CHECK, AT);
  else await rm(join(made.repo.recordsDir, "evidence", "A1.json"), { force: true });
  const shots = join(made.root, ".temp", "shots");
  await mkdir(join(made.root, ".temp", "tally", "logs"), { recursive: true });
  await mkdir(shots, { recursive: true });
  await writeFile(join(shots, "video.bin"), Buffer.alloc(ATTACHMENT_BYTES, 7));
  const log = join(made.root, ".temp", "tally", "logs", "run.log");
  await writeFile(log, "test result: ok. 1 passed; 0 failed\n".repeat(LOG_LINES));
  const ledger = await new Records(made.repo).readLedger();
  const run = { milestone: "A1", task: "1 read", kind: "green" as const, command: ["true"], cwd: made.root, started: AT.toISOString(), seconds: 1, exit: 0, logPath: log };
  const writing = Promise.allSettled([recordManual(made.repo, made.operator, { ...CHECK, attachments: [join(shots, "video.bin")] }, AT), recordEvidence(made.repo, made.operator, ledger, run)]);
  await delay(wait);
  await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);
  const [manual, ran] = await writing;
  return { made, ended: { manual, run: ran } as Ended };
}

function settledIn(result: PromiseSettledResult<unknown>, id: string | undefined, archived: readonly { id: string }[] | undefined): boolean {
  if (result.status === "rejected") return String(result.reason).includes("was archived with cycle 1");
  return archived?.some((one) => one.id === id) === true;
}

describe("a check made by hand and a run, begun before a close of their milestone", () => {
  test.each(DELAYS.flatMap((wait) => [true, false].map((hadFiles) => ({ wait, hadFiles }))))("each ends in the cycle's folder or is refused, none in the current folder, and no id twice: %o", async ({ wait, hadFiles }) => {
    const { made, ended } = await racing(hadFiles, wait);
    const current = join(made.repo.recordsDir);
    const cycle = cycleDir(made.repo.recordsDir, 1);
    const archivedChecks = await read(join(cycle, "manual", "A1.json"));
    const archivedRuns = await read(join(cycle, "evidence", "A1.json"));
    const manualId = ended.manual.status === "fulfilled" ? ended.manual.value.check.id : undefined;
    const runId = ended.run.status === "fulfilled" ? ended.run.value.record.id : undefined;

    expect([await read(join(current, "manual", "A1.json")), await read(join(current, "evidence", "A1.json"))]).toEqual([undefined, undefined]);
    expect([settledIn(ended.manual, manualId, archivedChecks), settledIn(ended.run, runId, archivedRuns)]).toEqual([true, true]);
    const ids = (archivedChecks ?? []).map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});
