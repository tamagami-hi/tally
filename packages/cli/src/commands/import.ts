import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_FILE, RECORDS_DIR, Records, TallyError, commitRecords, configSchema, fromBoard, importBuildlog, importChecks, importDecisions, importQuestions, writeJsonAtomic, type Repo } from "@tally/core";
import { flag, need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function importCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { force: { type: "boolean" }, group: { type: "string" } });
  const kind = need(parsed, 0, "what to import (board, decisions, questions, checks, buildlog)");
  if (kind === "checks") {
    const file = resolve(io.cwd, need(parsed, 1, "the code-checks markdown file"));
    const done = await importChecks(repo, file);
    io.out(`imported the code-check record at ${done.fingerprint} from ${file}: ${done.checks} checks, ${done.suites} suites, ${done.modules} modules with ${done.files} files`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
  if (kind === "buildlog") {
    const group = text(parsed, "group");
    if (group === undefined) throw new TallyError("tally import buildlog needs --group", 2);
    const file = resolve(io.cwd, need(parsed, 1, "the build-log markdown file"));
    const done = await importBuildlog(repo, file, group);
    io.out(`imported ${done.entries} build log sections of ${group} from ${file}`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
  if (kind === "decisions" || kind === "questions") {
    const group = text(parsed, "group");
    if (group === undefined) throw new TallyError(`tally import ${kind} needs --group`, 2);
    const file = resolve(io.cwd, need(parsed, 1, "the markdown file"));
    if (kind === "decisions") {
      const done = await importDecisions(repo, file, group);
      io.out(`imported ${done.decisions} decisions and ${done.replaced} replaced rows of ${group} from ${file}`);
      if (done.commit !== null) io.out(`records: ${done.commit}`);
    } else {
      const done = await importQuestions(repo, file, group);
      io.out(`imported ${done.open} open questions of ${group} from ${file}; next row ${done.nextRow}`);
      if (done.commit !== null) io.out(`records: ${done.commit}`);
    }
    return 0;
  }
  if (kind !== "board") throw new TallyError(`tally import: unknown source '${kind}'; use board, decisions, questions, checks or buildlog`, 2);
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
