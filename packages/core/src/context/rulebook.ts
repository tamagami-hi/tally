import { TallyError } from "../errors.ts";
import { commitRecords } from "../records/commit.ts";
import { keepsContextAsRecords } from "../schema/config.ts";
import { isOperator } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { authorOf, kindOfId, locked, putEntry, readKind, write, type Author, type Entry } from "./entries.ts";
import { isInForce } from "./find.ts";
import { isRuleSection } from "./rule-fields.ts";
import { RULEBOOK, RULEBOOK_SOURCE, RULE_SECTIONS, type RuleSection, type TemplateRule } from "./rulebook-template.ts";

export interface TailorInput {
  id: string;
  source: string;
  title?: string | undefined;
  text?: string | undefined;
  section?: string | undefined;
  paths?: readonly string[] | undefined;
  tags?: readonly string[] | undefined;
  refs?: readonly string[] | undefined;
}

export interface Adopted {
  added: { id: string; section: RuleSection; title: string }[];
  waiting: { id: string; title: string; tailor: string }[];
  already: number;
  commit: string | null;
}

export interface Tailored {
  entry: Entry;
  retired: Entry | undefined;
  waiting: number;
  commit: string | null;
}

export interface RulebookFilter {
  section?: string | undefined;
  waiting?: boolean | undefined;
}

export interface RulebookRead {
  rules: Entry[];
  waiting: number;
  template: { adopted: string[]; notAdopted: string[] };
}

const RULE = "rule";
const NUMBER_AT = 1;
const NOT_SECTIONED = RULE_SECTIONS.length;
const sectionList = `${RULE_SECTIONS.slice(0, -1).join(", ")} or ${RULE_SECTIONS.at(-1)}`;

const numberOf = (id: string): number => Number(id.split("-")[NUMBER_AT]);

const rankOf = (section: string | undefined): number => {
  const rank = section === undefined ? -1 : (RULE_SECTIONS as readonly string[]).indexOf(section);
  return rank === -1 ? NOT_SECTIONED : rank;
};

export function inRulebookOrder<T extends { id: string; section?: string | undefined }>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => rankOf(a.section) - rankOf(b.section) || numberOf(a.id) - numberOf(b.id));
}

export const waitingRules = (rules: readonly Entry[]): Entry[] => rules.filter((rule) => isInForce(rule) && rule.tailor !== undefined);

const waitingOf = (rules: readonly Entry[]): Adopted["waiting"] => inRulebookOrder(waitingRules(rules)).map(({ id, title, tailor }) => ({ id, title, tailor: tailor ?? "" }));

function mustBeOperator(repo: Repo, session: Author, what: string): void {
  if (!isOperator(repo, session)) throw new TallyError(`only an operator session ${what}; a track that wants ${what === "tailors a rule" ? "one changed" : "a rule"} asks a question with question_add`);
}

export async function adoptRulebook(repo: Repo, session: Author, now = new Date(), template: readonly TemplateRule[] = RULEBOOK): Promise<Adopted> {
  mustBeOperator(repo, session, "brings the rulebook");
  if (!keepsContextAsRecords(repo.config)) throw new TallyError("this repository's rules are its RULES.md (its config does not say context: \"records\"), so nothing was adopted");
  const at = now.toISOString();
  const done = await locked(repo, async () => {
    const file = await readKind(repo, RULE);
    const had = new Set(file.entries.flatMap((entry) => (entry.template === undefined ? [] : [entry.template])));
    const missing = template.filter((rule) => !had.has(rule.key));
    const entries: Entry[] = missing.map((rule, index) => ({
      id: `${RULE}-${file.nextNumber + index}`,
      kind: RULE,
      title: rule.title,
      text: rule.text,
      paths: [],
      tags: [],
      refs: [],
      by: authorOf(session),
      at,
      section: rule.section,
      source: RULEBOOK_SOURCE,
      template: rule.key,
      ...(rule.tailor === undefined ? {} : { tailor: rule.tailor }),
    }));
    const all = [...file.entries, ...entries];
    if (entries.length > 0) await write(repo, { ...file, nextNumber: file.nextNumber + entries.length, entries: all });
    return { entries, all, already: template.length - missing.length };
  });
  const commit = done.entries.length === 0 ? null : await commitRecords(repo, `${done.entries.length} rules of tally's rulebook template added by ${session.agent}`);
  return { added: done.entries.map(({ id, section, title }) => ({ id, section: section ?? "working", title })), waiting: waitingOf(done.all), already: done.already, commit };
}

function successorOf(rules: readonly Entry[], old: Entry): Entry | undefined {
  let current = rules.find((rule) => rule.replaces === old.id);
  while (current?.retiredAt !== undefined) {
    const next = rules.find((rule) => rule.replaces === current?.id);
    if (next === undefined) break;
    current = next;
  }
  return current;
}

const dayOf = (at: string): string => at.slice(0, 10);

function ruleInForce(rules: readonly Entry[], id: string): Entry {
  const found = rules.find((rule) => rule.id === id);
  if (found === undefined) throw new TallyError(`no rule ${id}; rulebook_get lists the rules`);
  if (found.retiredAt === undefined) return found;
  const successor = successorOf(rules, found);
  if (successor !== undefined) throw new TallyError(`${id} was replaced by ${successor.id} on ${dayOf(found.retiredAt)}; tailor ${successor.id}`);
  throw new TallyError(`${id} was retired on ${dayOf(found.retiredAt)} (${found.retiredWhy ?? "no reason given"}); a new rule is added with context_put`);
}

export async function tailorRule(repo: Repo, session: Author, input: TailorInput, now = new Date()): Promise<Tailored> {
  mustBeOperator(repo, session, "tailors a rule");
  if (kindOfId(input.id) !== RULE) throw new TallyError(`${input.id} is not a rule; rule_tailor changes a rule`);
  const old = ruleInForce((await readKind(repo, RULE)).entries, input.id);
  const written = await putEntry(repo, session, {
    kind: RULE,
    title: input.title ?? old.title,
    text: input.text ?? old.text,
    paths: input.paths ?? old.paths,
    tags: input.tags ?? old.tags,
    refs: input.refs ?? old.refs,
    replaces: input.id,
    source: input.source,
    ...(input.section === undefined && old.section === undefined ? {} : { section: input.section ?? old.section }),
  }, now);
  const waiting = waitingRules((await readKind(repo, RULE)).entries).length;
  return { entry: written.entry, retired: written.retired, waiting, commit: written.commit };
}

export async function readRulebook(repo: Repo, filter: RulebookFilter, template: readonly TemplateRule[] = RULEBOOK): Promise<RulebookRead> {
  if (filter.section !== undefined && !isRuleSection(filter.section)) throw new TallyError(`'${filter.section}' is not a rule section: ${sectionList}`);
  const all = (await readKind(repo, RULE)).entries;
  const inForce = inRulebookOrder(all.filter(isInForce));
  const kept = inForce.filter((rule) => (filter.section === undefined || rule.section === filter.section) && (filter.waiting !== true || rule.tailor !== undefined));
  const had = new Set(all.flatMap((entry) => (entry.template === undefined ? [] : [entry.template])));
  return {
    rules: kept,
    waiting: waitingRules(all).length,
    template: { adopted: template.filter((rule) => had.has(rule.key)).map((rule) => rule.key), notAdopted: template.filter((rule) => !had.has(rule.key)).map((rule) => rule.key) },
  };
}
