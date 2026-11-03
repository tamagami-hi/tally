import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_FILE, RECORDS_DIR, Records, TallyError, commitRecords, configSchema, fromBoard, writeJsonAtomic, type Repo } from "@tally/core";
import { flag, need, parse } from "../args.ts";
import type { IO } from "../io.ts";

export async function importCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { force: { type: "boolean" } });
  const kind = need(parsed, 0, "what to import (board)");
  if (kind !== "board") throw new TallyError(`tally import: unknown source '${kind}'; use board`, 2);
  const path = resolve(io.cwd, need(parsed, 1, "the board.json path"));
  const board = JSON.parse(await readFile(path, "utf8")) as unknown;
  const names = Object.fromEntries(repo.config.stages.map((stage) => [stage.id, stage.name]));
  const { ledger, stages } = fromBoard(board, names);
  const records = new Records(repo);
  const message = await records.locked(async () => {
    const existing = await records.readLedger();
    if (existing.milestones.length > 0 && !flag(parsed, "force")) {
      throw new TallyError(`${records.ledgerPath} already holds ${existing.milestones.length} milestones; pass --force to replace them`);
    }
    await records.writeLedger(ledger);
    const config = configSchema.parse({ ...repo.config, stages });
    await writeJsonAtomic(join(repo.root, RECORDS_DIR, CONFIG_FILE), config);
    const tasks = ledger.milestones.reduce((n, m) => n + m.tasks.length, 0);
    return `imported ${path}: ${ledger.milestones.length} milestones, ${tasks} tasks, ${ledger.other.length} other commits, ${stages.length} stages`;
  });
  io.out(message);
  const sha = await commitRecords(repo, "import the progress ledger");
  if (sha !== null) io.out(`records: ${sha}`);
  return 0;
}
