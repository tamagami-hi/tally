import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Decorator } from "../decorate.ts";
import { newestFirst, wholePaths } from "../meta.ts";
import { jsonText } from "../respond.ts";

export const ANSWER_LIMIT = 25_000;

const ROOM_FOR_THE_NOTE = 400;
const MOST_BESIDE = ANSWER_LIMIT / 4;
const LEAST_ROOM = 2_000;
const CUT_TEXTS_OVER: readonly number[] = [2_000, 200];
const MOST_CUTS = 40;
const NARROWING: ReadonlySet<string> = new Set(["ids", "group", "kind", "task", "track", "level", "scope", "fields", "since", "limit", "paths", "tags", "query", "state", "answered", "section", "waiting"]);
const WHOLE_ELSEWHERE = "Nothing narrows this tool: the whole of it is in the repository's docs/records.";
const NOTE_KEY = "truncated";
const NOTE_KEY_WHEN_TAKEN = "cut";

type Path = readonly (string | number)[];
type Answer = Record<string, unknown>;
type Content = CallToolResult["content"];

interface Part {
  path: Path;
  size: number;
  isList: boolean;
}

interface Cut {
  path: string;
  shown: number;
  of: number;
  isList: boolean;
}

function partsOf(value: unknown, textsOver: number, path: Path = []): Part[] {
  if (typeof value === "string") return value.length > textsOver ? [{ path, size: value.length, isList: false }] : [];
  if (Array.isArray(value)) {
    const own: Part[] = value.length > 1 ? [{ path, size: jsonText(value).length, isList: true }] : [];
    return [...own, ...value.flatMap((item, index) => partsOf(item, textsOver, [...path, index]))];
  }
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => partsOf(item, textsOver, [...path, key]));
  return [];
}

function isWhole(path: Path, keptWhole: readonly string[]): boolean {
  const name = path.join(".");
  return keptWhole.some((kept) => name === kept || name.startsWith(`${kept}.`));
}

function largestPart(value: unknown, keptWhole: readonly string[]): Part | undefined {
  for (const sparing of [true, false]) {
    for (const textsOver of CUT_TEXTS_OVER) {
      const candidates = partsOf(value, textsOver).filter((part) => !sparing || !isWhole(part.path, keptWhole));
      const largest = candidates.sort((a, b) => b.size - a.size)[0];
      if (largest !== undefined) return largest;
    }
  }
  return undefined;
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

function fitted(answer: Answer, room: number, fromTheStart: boolean, keptWhole: readonly string[]): { answer: Answer; cuts: Cut[] } {
  let current = answer;
  let cuts: Cut[] = [];
  for (let round = 0; round < MOST_CUTS && jsonText(current).length > room; round += 1) {
    const largest = largestPart(current, keptWhole);
    if (largest === undefined) break;
    const whole = valueAt(current, largest.path);
    const budget = Math.max(room - (jsonText(current).length - largest.size), 0);
    const kept = largest.isList ? shortened(whole as unknown[], budget, fromTheStart) : (whole as string).slice(0, Math.max(budget, CUT_TEXTS_OVER.at(-1) ?? 0));
    const name = largest.path.join(".");
    const of = cuts.find((cut) => cut.path === name)?.of ?? (whole as { length: number }).length;
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

function keysOfAnswerText(text: string): string[] | undefined {
  if (!text.startsWith("{")) return undefined;
  try {
    const read: unknown = JSON.parse(text);
    return typeof read === "object" && read !== null && !Array.isArray(read) ? Object.keys(read) : undefined;
  } catch {
    return undefined;
  }
}

const textsOf = (content: Content): string[] => content.map((part) => (part.type === "text" ? part.text : ""));

const lengthOf = (texts: readonly string[]): number => texts.reduce((sum, text) => sum + text.length, 0);

function indexOfLongest(texts: readonly string[]): number {
  return texts.reduce((longest, text, index) => (text.length > (texts[longest] ?? "").length ? index : longest), 0);
}

function tooLargeToCut(size: number, params: readonly string[], had: boolean): CallToolResult {
  const text = `This answer is ${size} characters, and nothing in it could be cut to fit ${ANSWER_LIMIT}. ${narrowing(params)}`;
  return { content: [{ type: "text", text }], ...(had ? { structuredContent: { [NOTE_KEY]: [{ path: "", shown: 0, of: size }] } } : {}) };
}

export const sized: Decorator = async ({ tool, params, result }) => {
  if (result.isError === true) return result;
  const original = result.structuredContent;
  const texts = textsOf(result.content);
  const wholeSize = original === undefined ? lengthOf(texts) : jsonText(original).length;
  if (lengthOf(texts) <= ANSWER_LIMIT && (original === undefined || wholeSize <= ANSWER_LIMIT)) return result;

  const fromTheStart = newestFirst(tool);
  const answerKeys = original === undefined ? [] : texts.map(keysOfAnswerText);
  const answerAt = answerKeys.findIndex((keys) => keys !== undefined);
  const mainAt = answerAt >= 0 ? answerAt : indexOfLongest(texts);
  const beside = texts.map((text, index) => (index === mainAt || text.length <= MOST_BESIDE ? text : text.slice(0, MOST_BESIDE)));
  const room = Math.max(ANSWER_LIMIT - ROOM_FOR_THE_NOTE - (lengthOf(beside) - (beside[mainAt] ?? "").length), LEAST_ROOM);

  const { answer, cuts } = original === undefined ? { answer: undefined, cuts: [] } : fitted(original, room, fromTheStart, wholePaths(tool));
  const noteKey = answer !== undefined && NOTE_KEY in answer ? NOTE_KEY_WHEN_TAKEN : NOTE_KEY;
  const structured = answer === undefined || cuts.length === 0 ? answer : { ...answer, [noteKey]: cuts.map(({ path, shown, of }) => ({ path, shown, of })) };
  const mainText = texts[mainAt] ?? "";
  const shownKeys = [...(answerKeys[answerAt] ?? []), noteKey];
  const main = answerAt >= 0 && structured !== undefined ? jsonText(Object.fromEntries(Object.entries(structured).filter(([key]) => shownKeys.includes(key)))) : mainText.slice(0, room);
  const textCut = answerAt < 0 && main.length < mainText.length ? [`its text shows the first ${main.length} of ${mainText.length} characters`] : [];
  const cutNotes = [...cuts.map((cut) => said(cut, fromTheStart)), ...textCut];
  const fits = main.length <= room && (structured === undefined || jsonText(structured).length <= ANSWER_LIMIT);
  if (!fits || cutNotes.length === 0) return tooLargeToCut(wholeSize, params, original !== undefined);

  const content = result.content.map((part, index) => (part.type === "text" ? { ...part, text: index === mainAt ? main : (beside[index] ?? part.text) } : part));
  const note = `This answer was cut to fit ${ANSWER_LIMIT} characters: ${cutNotes.join("; ")}. ${narrowing(params)}`;
  return { ...result, content: [...content, { type: "text", text: note }], ...(structured === undefined ? {} : { structuredContent: structured }) };
};
