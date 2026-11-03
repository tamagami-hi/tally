export interface Table {
  section: string | undefined;
  header: string[];
  rows: { line: number; cells: string[] }[];
}

export function splitRaw(line: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inCode = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of body) {
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) {
      segments.push(current);
      current = "";
    } else current += char;
  }
  segments.push(current);
  return segments;
}

export function fit(segments: readonly string[], width: number): string[] {
  const merged = [...segments];
  while (merged.length > width && merged.length >= 3) {
    const [first, second, ...rest] = merged.slice(1);
    merged.splice(1, merged.length - 1, `${first ?? ""}|${second ?? ""}`, ...rest);
  }
  return merged.map((s) => s.trim());
}

export const splitCells = (line: string, width?: number): string[] => fit(splitRaw(line), width ?? splitRaw(line).length);

export const renderRow = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

const isDivider = (cells: string[]): boolean => cells.every((c) => /^:?-{3,}:?$/.test(c));

export function parseTables(text: string): Table[] {
  const tables: Table[] = [];
  let section: string | undefined;
  let current: Table | undefined;
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("#")) {
      section = line.replace(/^#+\s*/, "");
      current = undefined;
      return;
    }
    if (!line.startsWith("|")) {
      current = undefined;
      return;
    }
    if (current === undefined) {
      current = { section, header: splitCells(line), rows: [] };
      tables.push(current);
      return;
    }
    const cells = splitCells(line, current.header.length);
    if (isDivider(cells)) return;
    current.rows.push({ line: index + 1, cells });
  });
  return tables.filter((t) => t.rows.length > 0 || t.header.length > 1);
}
