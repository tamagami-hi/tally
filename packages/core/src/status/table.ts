export class Paint {
  readonly on: boolean;

  constructor(on: boolean) {
    this.on = on;
  }

  call(text: string, ...codes: string[]): string {
    if (!this.on || codes.length === 0) return text;
    return `\u001b[${codes.join(";")}m${text}\u001b[0m`;
  }
}

export interface PaintFn {
  (text: string, ...codes: string[]): string;
}

export const BOLD = "1";
export const DIM = "2";
export const GREEN = "32";
export const YELLOW = "33";
export const CYAN = "36";
export const RED = "31";

export class Raw {
  readonly rendered: string;
  readonly visible: number;

  constructor(rendered: string, visible: number) {
    this.rendered = rendered;
    this.visible = visible;
  }
}

export type Cell = string | [string, string[]] | Raw;
export type Row = Cell[] | "---";

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const part of text.split("\n")) {
    let line = "";
    for (const chunk of part.match(/\S+\s*/g) ?? []) {
      let rest = chunk;
      while (rest.trimEnd().length > width) {
        if (line.length > 0) {
          lines.push(line.trimEnd());
          line = "";
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if ((line + rest).trimEnd().length <= width) line += rest;
      else {
        lines.push(line.trimEnd());
        line = rest;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function fit(widths: number[], flexible: number, total: number, minimum: number): number[] {
  const used = widths.reduce((sum, w, i) => (i === flexible ? sum : sum + w), 0) + 3 * widths.length + 1;
  return widths.map((w, i) => (i === flexible ? Math.max(minimum, total - used) : w));
}

export function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

export function bar(share: number, width: number, paint: Paint): string {
  const filled = Math.round(share * width);
  const colour = share >= 1 ? GREEN : share > 0 ? YELLOW : DIM;
  return paint.call("█".repeat(filled), colour) + paint.call("░".repeat(width - filled), DIM);
}

export function pctColour(share: number): string {
  return share >= 1 ? GREEN : share > 0 ? YELLOW : DIM;
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`.padStart(4);
}

function pad(text: string, width: number, align: string): string {
  return align === ">" ? text.padStart(width) : text.padEnd(width);
}

export function table(headers: string[], rows: Row[], widths: number[], paint: Paint, aligns?: string[]): string {
  const align = aligns ?? headers.map(() => "<");
  const line = (l: string, m: string, r: string): string => paint.call(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r, DIM);
  const out = [line("┌", "┬", "┐")];
  const emit = (cells: Cell[], header = false): void => {
    const wrapped = cells.map((cell, i): { lines: (string | Raw)[]; codes: string[] } => {
      if (cell instanceof Raw) return { lines: [cell], codes: [] };
      const [text, codes] = typeof cell === "string" ? [cell, []] : cell;
      return { lines: wrap(text, widths[i] ?? 1), codes };
    });
    const height = Math.max(...wrapped.map((w) => w.lines.length));
    for (let i = 0; i < height; i += 1) {
      const parts = wrapped.map(({ lines, codes }, column) => {
        const width = widths[column] ?? 1;
        const raw = lines[i] ?? "";
        if (raw instanceof Raw) return raw.rendered + " ".repeat(Math.max(0, width - raw.visible));
        const padded = pad(raw, width, align[column] ?? "<");
        return header ? paint.call(padded, BOLD) : paint.call(padded, ...codes);
      });
      out.push(`${paint.call("│", DIM)} ${parts.join(` ${paint.call("│", DIM)} `)} ${paint.call("│", DIM)}`);
    }
  };
  emit(headers, true);
  out.push(line("├", "┼", "┤"));
  for (const row of rows) {
    if (row === "---") out.push(line("├", "┼", "┤"));
    else emit(row);
  }
  out.push(line("└", "┴", "┘"));
  return out.join("\n");
}
