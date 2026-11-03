import { TallyError, addDecision, readDecisions, replaceDecision, setDecisionStatus, type Repo } from "@tally/core";
import { flag, need, parse, text, type Parsed } from "../args.ts";
import type { IO } from "../io.ts";

const OPTIONS = { group: { type: "string" }, text: { type: "string" }, since: { type: "string" }, status: { type: "string" }, section: { type: "string" }, why: { type: "string" }, by: { type: "string" }, operator: { type: "boolean" } } as const;

function fields(parsed: Parsed, verb: string): { id: string; group: string; section?: string; text: string; since: string; status: string } {
  const id = need(parsed, 0, "the decision id");
  const group = text(parsed, "group");
  const body = text(parsed, "text");
  const since = text(parsed, "since");
  const status = text(parsed, "status");
  if (group === undefined || body === undefined || since === undefined || status === undefined) throw new TallyError(`decision ${verb} needs --group, --text, --since and --status`, 2);
  const section = text(parsed, "section");
  return { id, group, ...(section === undefined ? {} : { section }), text: body, since, status };
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
      io.out(`decision ${decision.id} (${decision.group}) added: ${decision.state}`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "replace": {
      const why = text(parsed, "why");
      if (why === undefined) throw new TallyError("decision replace needs --why", 2);
      const { decision, replaced, commit } = await replaceDecision(repo, { ...fields(parsed, "replace"), why }, { operator });
      io.out(`decision ${decision.id} (${decision.group}) replaced; the old row is kept as replaced ${replaced.replaced}`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "setStatus":
    case "set-status": {
      const id = need(parsed, 0, "the decision id");
      const group = text(parsed, "group");
      const status = text(parsed, "status");
      if (group === undefined || status === undefined) throw new TallyError("decision setStatus needs --group and --status", 2);
      const by = text(parsed, "by") ?? (operator ? "operator" : "build");
      const { decision, commit } = await setDecisionStatus(repo, { id, group, status }, { by });
      io.out(`decision ${decision.id} (${decision.group}): ${decision.status} [${decision.state}]`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    default:
      throw new TallyError(`tally decision: unknown verb '${verb ?? ""}'; use list, add, replace or setStatus`, 2);
  }
}
