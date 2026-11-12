import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Decorator } from "../decorate.ts";
import { newestFirst } from "../meta.ts";
import { jsonText } from "../respond.ts";

export const ANSWER_LIMIT = 25_000;

const ROOM_FOR_THE_NOTE = 400;
const SHORTEST_CUT_TEXT = 2_000;
const MOST_CUTS = 20;
const NARROWING: ReadonlySet<string> = new Set(["ids", "group", "kind", "task", "track", "level", "scope", "fields", "since", "limit", "paths", "tags", "query", "state", "answered"]);
const WHOLE_ELSEWHERE = "Nothing narrows this tool: the whole of it is in the repository's docs/records.";

type Path = readonly (string | number)[];
type Answer = Record<string, unknown>;

interface Part {
  path: Path;
  size: number;
  isList: boolean;
}

export interface Cut {
  path: string;
  shown: number;
  of: number;
  isList: boolean;
}

function partsOf(value: unknown, path: Path = []): Part[] {
  if (typeof value === "string") return value.length > SHORTEST_CUT_TEXT ? [{ path, size: value.length, isList: false }] : [];
  if (Array.isArray(value)) {
    const own: Part[] = value.length > 1 ? [{ path, size: jsonText(value).length, isList: true }] : [];
    return [...own, ...value.flatMap((item, index) => partsOf(item, [...path, index]))];
  }
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => partsOf(item, [...path, key]));
  return [];
}

function valueAt(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (Array.isArray(node) ? node[Number(key)] : (node as Answer)[String(key)]), value);
}

function replacedAt(value: unknown, path: Path, next: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return next;
  if (Array.isArray(value)) return value.map((item: unknown, index) => (index === head ? replacedAt(item, rest, next) : item));
  const record = value as Answer;
  return { ...record, [head]: replacedAt(record[String(head)], rest, next) };
}

function shortened(list: readonly unknown[], budget: number, fromTheStart: boolean): unknown[] {
  const ordered = fromTheStart ? [...list] : [...list].reverse();
  const kept: unknown[] = [];
  let used = 2;
  for (const item of ordered) {
    used += jsonText(item).length + 1;
    if (used > budget && kept.length > 0) break;
    kept.push(item);
  }
  return fromTheStart ? kept : kept.reverse();
}

function fitted(answer: Answer, fromTheStart: boolean): { answer: Answer; cuts: Cut[] } {
  const target = ANSWER_LIMIT - ROOM_FOR_THE_NOTE;
  let current = answer;
  let cuts: Cut[] = [];
  for (let round = 0; round < MOST_CUTS && jsonText(current).length > target; round += 1) {
    const largest = partsOf(current).sort((a, b) => b.size - a.size)[0];
    if (largest === undefined) break;
    const whole = valueAt(current, largest.path);
    const budget = Math.max(target - (jsonText(current).length - largest.size), 0);
    const kept = largest.isList ? shortened(whole as unknown[], budget, fromTheStart) : (whole as string).slice(0, Math.max(budget, SHORTEST_CUT_TEXT / 2));
    const name = largest.path.join(".");
    const before = cuts.find((cut) => cut.path === name);
    const of = before?.of ?? (whole as { length: number }).length;
    cuts = [...cuts.filter((cut) => cut.path !== name), { path: name, shown: kept.length, of, isList: largest.isList }];
    current = replacedAt(current, largest.path, kept) as Answer;
  }
  return { answer: current, cuts };
}

function said(cut: Cut, fromTheStart: boolean): string {
  if (!cut.isList) return `${cut.path} shows the first ${cut.shown} of ${cut.of} characters`;
  return `${cut.path} shows the ${fromTheStart ? "first" : "last"} ${cut.shown} of ${cut.of}`;
}

function narrowing(params: readonly string[]): string {
  const names = params.filter((param) => NARROWING.has(param));
  if (names.length === 0) return WHOLE_ELSEWHERE;
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
  return `Narrow it with ${listed}.`;
}

function isTooLarge(result: CallToolResult): boolean {
  const texts = result.content.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
  return texts > ANSWER_LIMIT || (result.structuredContent !== undefined && jsonText(result.structuredContent).length > ANSWER_LIMIT);
}

export const sized: Decorator = async ({ tool, params, result }) => {
  if (result.isError === true || !isTooLarge(result)) return result;
  const fromTheStart = newestFirst(tool);
  const original = result.structuredContent ?? {};
  const { answer, cuts } = fitted(original, fromTheStart);
  const structured = cuts.length === 0 ? answer : { ...answer, truncated: cuts.map(({ path, shown, of }) => ({ path, shown, of })) };
  const whole = jsonText(original);
  const content = result.content.map((part) => {
    if (part.type !== "text") return part;
    if (part.text === whole) return { ...part, text: jsonText(structured) };
    return part.text.length > ANSWER_LIMIT ? { ...part, text: part.text.slice(0, ANSWER_LIMIT - ROOM_FOR_THE_NOTE) } : part;
  });
  const cutNote = cuts.length === 0 ? "its text was shortened" : cuts.map((cut) => said(cut, fromTheStart)).join("; ");
  const note = `This answer was cut to fit ${ANSWER_LIMIT} characters: ${cutNote}. ${narrowing(params)}`;
  return { ...result, content: [...content, { type: "text", text: note }], ...(result.structuredContent === undefined ? {} : { structuredContent: structured }) };
};
