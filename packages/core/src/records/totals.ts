import { stripVTControlCharacters } from "node:util";

type Totals = Record<"passed" | "failed" | "ignored", number>;

const RUNNERS: readonly { lines: RegExp; ignored: readonly string[] }[] = [
  { lines: /\d+ passed; \d+ failed; \d+ ignored/g, ignored: ["ignored"] },
  { lines: /^[ \t]*Tests[ \t]+\d.*$/gm, ignored: ["skipped", "todo"] },
  { lines: /^=* *(?:\d+ [a-z]+(?:, )?)+ in \d[\d.]*s\b/gm, ignored: ["skipped", "xfailed"] },
];

const count = (line: string, word: string): number => Number(new RegExp(`\\b(\\d+) ${word}\\b`).exec(line)?.[1] ?? 0);

function tallied(line: string, ignored: readonly string[]): Totals {
  return { passed: count(line, "passed"), failed: count(line, "failed"), ignored: ignored.reduce((sum, word) => sum + count(line, word), 0) };
}

export function summarize(output: string): Record<string, number> | undefined {
  const text = stripVTControlCharacters(output);
  const found = RUNNERS.flatMap(({ lines, ignored }) => [...text.matchAll(lines)].map(([line]) => tallied(line, ignored)));
  if (found.length === 0) return undefined;
  return found.reduce((sum, each) => ({ passed: sum.passed + each.passed, failed: sum.failed + each.failed, ignored: sum.ignored + each.ignored }), { passed: 0, failed: 0, ignored: 0 });
}
