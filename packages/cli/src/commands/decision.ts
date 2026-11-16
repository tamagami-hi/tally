import { DECISION_STATES, TallyError, addDecision, readDecisions, replaceDecision, setDecisionStatus, type Decision, type DecisionState, type Repo } from "@tally/core";
import { flag, need, parse, text, type Parsed } from "../args.ts";
import type { IO } from "../io.ts";
import { onRecord } from "../on-record.ts";

const OPTIONS = { group: { type: "string" }, text: { type: "string" }, since: { type: "string" }, status: { type: "string" }, state: { type: "string" }, section: { type: "string" }, why: { type: "string" }, by: { type: "string" }, operator: { type: "boolean" } } as const;

const quoted = (words: readonly string[]): string => `${words.slice(0, -1).map((word) => `'${word}'`).join(", ")} or '${words.at(-1) ?? ""}'`;

const STATE_HINT = `the status names no state, so it is filed as 'other'; give one with --state: ${quoted(DECISION_STATES.filter((state) => state !== "other"))}`;

function stateGiven(parsed: Parsed): DecisionState | undefined {
  const given = text(parsed, "state");
  if (given === undefined) return undefined;
  const known = DECISION_STATES.find((state) => state === given);
  if (known === undefined) throw new TallyError(`--state must be one of ${quoted(DECISION_STATES)}, not '${given}'`, 2);
  return known;
}

function fields(parsed: Parsed, verb: string): { id: string; group: string; section?: string; text: string; since: string; status: string; state?: DecisionState } {
  const id = need(parsed, 0, "the decision id");
  const group = text(parsed, "group");
  const body = text(parsed, "text");
  const since = text(parsed, "since");
  const status = text(parsed, "status");
  if (group === undefined || body === undefined || since === undefined || status === undefined) throw new TallyError(`decision ${verb} needs --group, --text, --since and --status`, 2);
  const section = text(parsed, "section");
  const state = stateGiven(parsed);
  return { id, group, ...(section === undefined ? {} : { section }), text: body, since, status, ...(state === undefined ? {} : { state }) };
}

async function answered(repo: Repo, io: IO, parsed: Parsed, written: { verb: string; decision: Decision; commit: string | null; line: string }): Promise<number> {
  const { verb, decision, commit, line } = written;
  io.out(line);
  if (text(parsed, "state") === undefined && decision.state === "other") io.out(STATE_HINT);
  if (commit !== null) io.out(`records: ${commit}`);
  await onRecord(repo, io, { verb, target: `${decision.group} / ${decision.id}: ${decision.state}`, by: text(parsed, "by") });
  return 0;
}

export async function decisionCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  const parsed = parse(rest, OPTIONS);
  const operator = flag(parsed, "operator");
  switch (verb) {
    case "list": {
      const group = text(parsed, "group");
      const file = await readDecisions(repo);
      const shown = file.decisions.filter((d) => group === undefined || d.group === group);
      for (const d of shown) io.out(`${d.group}:${d.id} [${d.state}] ${d.text}`);
      io.out(`${shown.length} decisions; ${file.replaced.filter((r) => group === undefined || r.group === group).length} replaced`);
      return 0;
    }
    case "add": {
      const { decision, commit } = await addDecision(repo, fields(parsed, "add"), { operator });
      return answered(repo, io, parsed, { verb: "decision_add", decision, commit, line: `decision ${decision.id} (${decision.group}) added: ${decision.state}` });
    }
    case "replace": {
      const why = text(parsed, "why");
      if (why === undefined) throw new TallyError("decision replace needs --why", 2);
      const { decision, replaced, commit } = await replaceDecision(repo, { ...fields(parsed, "replace"), why }, { operator });
      return answered(repo, io, parsed, { verb: "decision_replace", decision, commit, line: `decision ${decision.id} (${decision.group}) replaced; the old row is kept as replaced ${replaced.replaced}` });
    }
    case "setStatus":
    case "set-status": {
      const id = need(parsed, 0, "the decision id");
      const group = text(parsed, "group");
      const status = text(parsed, "status");
      if (group === undefined || status === undefined) throw new TallyError("decision setStatus needs --group and --status", 2);
      const state = stateGiven(parsed);
      const by = text(parsed, "by") ?? (operator ? "operator" : "build");
      const { decision, commit } = await setDecisionStatus(repo, { id, group, status, ...(state === undefined ? {} : { state }) }, { by });
      return answered(repo, io, parsed, { verb: "decision_status", decision, commit, line: `decision ${decision.id} (${decision.group}): ${decision.status} [${decision.state}]` });
    }
    default:
      throw new TallyError(`tally decision: unknown verb '${verb ?? ""}'; use list, add, replace or setStatus`, 2);
  }
}
