import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_FILE, RECORDS_DIR, Records, TallyError, answeredRowsSchema, commitRecords, configSchema, fromBoard, evidenceKinds, importAnswered, importBuildlog, importChecks, importDecisions, importEvidence, importQuestions, readJson, scanDocuments, scanPlans, writeJsonAtomic, type EvidenceKind, type Repo } from "@tally/core";
import { flag, need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function importCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { force: { type: "boolean" }, group: { type: "string" }, milestone: { type: "string" }, task: { type: "string" }, kind: { type: "string" }, flat: { type: "boolean" } });
  const kind = need(parsed, 0, "what to import (board, decisions, questions, answered, checks, buildlog, evidence, plans, documents)");
  if (kind === "answered") {
    const file = resolve(io.cwd, need(parsed, 1, "the JSON file of answered rows"));
    const done = await importAnswered(repo, await readJson(file, answeredRowsSchema));
    io.out(`imported ${done.answered} answered questions from ${file}`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
  if (kind === "documents") {
    const done = await scanDocuments(repo);
    io.out(`scanned ${done.documents} documents, ${done.purposes} with a purpose from an index`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
  if (kind === "evidence") {
    const milestone = text(parsed, "milestone");
    const task = text(parsed, "task");
    if (milestone === undefined || task === undefined) throw new TallyError("tally import evidence needs --milestone and --task", 2);
    const given = text(parsed, "kind");
    if (given !== undefined && !(evidenceKinds as readonly string[]).includes(given)) throw new TallyError(`--kind must be one of ${evidenceKinds.join(", ")}`, 2);
    const dir = resolve(io.cwd, need(parsed, 1, "the folder of run records"));
    const done = await importEvidence(repo, dir, { milestone, task, flat: flag(parsed, "flat"), ...(given === undefined ? {} : { kind: given as EvidenceKind }) });
    io.out(`indexed ${done.indexed} run records (${done.withLogs} with logs) of ${milestone} '${task}' from ${dir}; ${done.skipped} already indexed, ${done.ignored} json files not run records`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
  if (kind === "plans") {
    const done = await scanPlans(repo);
    io.out(`scanned the plans: ${done.next} in next/, ${done.completed} in completed/`);
    if (done.commit !== null) io.out(`records: ${done.commit}`);
    return 0;
  }
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
  if (kind !== "board") throw new TallyError(`tally import: unknown source '${kind}'; use board, decisions, questions, answered, checks, buildlog, evidence, plans or documents`, 2);
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
