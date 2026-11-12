import { readQuestions } from "../records/questions.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { OpenQuestions } from "../status/questions.ts";
import type { Repo } from "../store/records.ts";
import { readKind, type Entry } from "./entries.ts";
import { isInForce } from "./find.ts";
import { overview, type Live } from "./overview.ts";
import type { Pack } from "./pack.ts";
import { readProject, type Project } from "./project.ts";

const NO_PURPOSE = "(no purpose yet: an operator session sets it with project_set)";
const NO_RULE = "(no rule yet: an operator session adds one with context_put)";
const FIRST_ROW = 1;

async function questionsInRecords(repo: Repo): Promise<OpenQuestions> {
  const file = await readQuestions(repo);
  return { rows: (file?.open ?? []).map((q) => `${q.row} (${q.group})`), nextRow: file?.nextRow ?? FIRST_ROW };
}

const listed = (heading: string, items: readonly string[]): string[] => (items.length === 0 ? [] : ["", heading, ...items.map((item) => `- ${item}`)]);

export function projectLines(project: Project): string[] {
  return [
    project.purpose.trim() === "" ? NO_PURPOSE : project.purpose,
    ...(project.stack.length === 0 ? [] : ["", `Stack: ${project.stack.join(", ")}.`]),
    ...listed("Layout:", project.layout.map(({ path, what }) => `${path}: ${what}`)),
    ...listed("Glossary:", project.glossary.map(({ term, means }) => `${term}: ${means}`)),
  ];
}

export function ruleLines(rules: readonly Entry[]): string[] {
  return rules.length === 0 ? [NO_RULE] : rules.map((rule) => `### ${rule.id}. ${rule.title}\n\n${rule.text}`).join("\n\n").split("\n");
}

export async function projectFromRecords(repo: Repo, ledger: Ledger, live: Live): Promise<Pack> {
  const shared = overview(repo, ledger, live, await questionsInRecords(repo));
  const project = await readProject(repo);
  const rules = (await readKind(repo, "rule")).entries.filter(isInForce);
  const parts = { ...shared.parts, project, rules };
  const text = [...shared.lines, "", "## Project", "", ...projectLines(project), "", "## Rules", "", ...ruleLines(rules)].join("\n");
  return { level: "project", parts, text };
}
