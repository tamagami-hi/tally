import { TallyError } from "../errors.ts";
import { renderRow, splitCells } from "./markdown.ts";

export interface Section {
  heading: string;
  lines: string[];
}

export interface ParsedTable {
  header: string[];
  rows: string[][];
  end: number;
}

export function blob(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

export function splitSections(lines: readonly string[], prefix: string): { before: string[]; sections: Section[] } {
  const before: string[] = [];
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      current = { heading: line.slice(prefix.length), lines: [] };
      sections.push(current);
    } else if (current === undefined) before.push(line);
    else current.lines.push(line);
  }
  return { before, sections };
}

export function takeTable(lines: readonly string[], start: number, what: string): ParsedTable {
  const headerLine = lines[start];
  if (headerLine === undefined || !headerLine.startsWith("|")) throw new TallyError(`${what}: expected a table, found '${headerLine ?? "end of text"}'`);
  const header = splitCells(headerLine);
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index]!.startsWith("|")) {
    rows.push(splitCells(lines[index]!, header.length));
    index += 1;
  }
  return { header, rows, end: index };
}

export function renderTable(header: readonly string[], rows: readonly (readonly string[])[], headerLine?: string): string {
  const divider = `| ${header.map(() => "---").join(" | ")} |`;
  return [headerLine ?? renderRow(header), divider, ...rows.map((cells) => renderRow(cells))].join("\n");
}

export function stripCode(cell: string): string {
  const match = /^`([^`]*)`$/.exec(cell);
  return match === null ? cell : (match[1] ?? "");
}
