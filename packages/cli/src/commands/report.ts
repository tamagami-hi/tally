import { TallyError, writeReportManifest, type Repo } from "@tally/core";
import { list, need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function reportCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb !== "manifest") throw new TallyError(`tally report: unknown verb '${verb ?? ""}'; use manifest`, 2);
  const parsed = parse(rest, { group: { type: "string" }, narrative: { type: "string" }, bundle: { type: "string" }, fingerprint: { type: "string" }, evidence: { type: "string", multiple: true }, decision: { type: "string", multiple: true }, question: { type: "string", multiple: true } });
  const group = text(parsed, "group");
  const narrative = text(parsed, "narrative");
  if (group === undefined || narrative === undefined) throw new TallyError("report manifest needs --group and --narrative", 2);
  const bundle = text(parsed, "bundle");
  const fingerprint = text(parsed, "fingerprint");
  const questions = list(parsed, "question").map((q) => {
    const row = Number(q);
    if (!Number.isInteger(row)) throw new TallyError(`--question takes a row number, not '${q}'`, 2);
    return row;
  });
  const evidence = list(parsed, "evidence").map((cite) => {
    const [milestone = "", ...task] = cite.split(":");
    return task.length === 0 ? { milestone } : { milestone, task: task.join(":") };
  });
  const { manifest, path, commit } = await writeReportManifest(repo, {
    date: need(parsed, 0, "the report's date"),
    name: need(parsed, 1, "the report's name"),
    group,
    narrative,
    ...(bundle === undefined ? {} : { bundle }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    evidence,
    decisions: list(parsed, "decision"),
    questions,
  });
  io.out(`wrote ${path}: cites ${manifest.cites.evidence.length} evidence records, ${manifest.cites.decisions.length} decisions, ${manifest.cites.questions.length} questions; ${manifest.bundled.length} bundled files hashed`);
  if (commit !== null) io.out(`records: ${commit}`);
  return 0;
}
