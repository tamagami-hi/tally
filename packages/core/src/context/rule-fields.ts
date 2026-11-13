import { TallyError } from "../errors.ts";
import { RULE_SECTIONS, type RuleSection } from "./rulebook-template.ts";

export const MAX_SOURCE = 200;
export const MAX_TAILOR = 300;

export interface RuleFields {
  section: RuleSection;
  source: string;
  template?: string;
}

export interface RuleFieldsInput {
  section?: string | undefined;
  source?: string | undefined;
}

interface Inherited {
  kind: string;
  section?: RuleSection | undefined;
  template?: string | undefined;
}

const SECTION_HELP = "authority (what wins when sources disagree), safety (what fails the work), working (how the work is done) or once (doing each thing once)";
const SOURCE_EXAMPLE = '"the operator, 2026-11-14"';

export const isRuleSection = (value: string): value is RuleSection => (RULE_SECTIONS as readonly string[]).includes(value);

function sectionOf(given: string | undefined, inherited: RuleSection | undefined): RuleSection {
  const asked = given?.trim();
  const section = asked === undefined || asked === "" ? inherited : asked;
  if (section === undefined) throw new TallyError(`a rule needs its section: ${SECTION_HELP}`);
  if (!isRuleSection(section)) throw new TallyError(`'${section}' is not a rule section: ${RULE_SECTIONS.slice(0, -1).join(", ")} or ${RULE_SECTIONS.at(-1)}`);
  return section;
}

function sourceOf(given: string | undefined): string {
  const source = given?.trim() ?? "";
  if (source === "") throw new TallyError(`a rule needs its source: whose word it is and when, such as ${SOURCE_EXAMPLE}, or the id of the decision it rests on`);
  if (/[\r\n]/.test(source)) throw new TallyError(`a rule's source is one line, such as ${SOURCE_EXAMPLE}`);
  if (source.length > MAX_SOURCE) throw new TallyError(`a rule's source holds at most ${MAX_SOURCE} characters; this one has ${source.length}`);
  return source;
}

export function refuseRuleFieldsOnAnyOther(input: RuleFieldsInput): void {
  if (input.section !== undefined || input.source !== undefined) throw new TallyError("only a rule has a section and a source");
}

export function ruleFieldsOf(input: RuleFieldsInput, replaced: Inherited | undefined): RuleFields {
  const old = replaced?.kind === "rule" ? replaced : undefined;
  const section = sectionOf(input.section, old?.section);
  const source = sourceOf(input.source);
  return { section, source, ...(old?.template === undefined ? {} : { template: old.template }) };
}
