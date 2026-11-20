import { TallyError } from "../errors.ts";

export const MOST_ACCEPT_LINES = 12;
export const MOST_ACCEPT_LINE = 300;

export function checkedAccept(lines: readonly string[]): string[] {
  if (lines.length > MOST_ACCEPT_LINES) throw new TallyError(`accept holds at most ${MOST_ACCEPT_LINES} lines; this one has ${lines.length}`);
  const long = lines.findIndex((line) => line.length > MOST_ACCEPT_LINE);
  if (long >= 0) throw new TallyError(`a line of accept holds at most ${MOST_ACCEPT_LINE} characters; line ${long + 1} has ${lines[long]?.length ?? 0}`);
  return [...lines];
}
