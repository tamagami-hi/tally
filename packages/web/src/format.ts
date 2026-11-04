export const percent = (share: number): string => `${Math.round(share * 100)}%`;

export type Tone = "done" | "active" | "idle" | "warn";

export function tone(share: number): Tone {
  if (share >= 1) return "done";
  if (share > 0) return "active";
  return "idle";
}

export function splitNote(note: string): { kind: "next" | "waits" | "plain"; text: string } {
  const next = /^(.+) next: (.+)$/.exec(note);
  if (next !== null) return { kind: "next", text: `${next[2]} (${next[1]})` };
  const waits = /^(.+): waits for (.+)$/.exec(note);
  if (waits !== null) return { kind: "waits", text: `${waits[1]} waits for ${waits[2]}` };
  return { kind: "plain", text: note };
}

export function sinceText(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

export const statusClass = (mark: string): string => (mark === "M" ? "m" : mark === "A" ? "a" : mark === "D" ? "d" : "u");

const KIND_TONES: Record<string, string> = { red: "warn", green: "done", land: "accent", clippy: "idle", fmt: "idle", coverage: "idle", sweep: "idle", evidence: "idle" };

export const kindTone = (kind: string): string => KIND_TONES[kind] ?? "line";

export function secondsText(seconds: number): string {
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export function summaryText(summary: Record<string, number | string | boolean>): string {
  const counts = ["passed", "failed", "ignored"].filter((key) => typeof summary[key] === "number").map((key) => `${summary[key]} ${key}`);
  const rest = Object.entries(summary).filter(([key, value]) => !["passed", "failed", "ignored"].includes(key) && typeof value !== "number").map(([key, value]) => `${key} ${String(value).slice(0, 7)}`);
  return [...counts, ...rest].join(" · ");
}

export function countsText(records: readonly { kind: string }[]): string {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${count} ${kind}`).join(" · ");
}

export const bytesText = (bytes: number): string => `${bytes.toLocaleString("en-US")} bytes`;

export const plainText = (markdown: string): string => markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "");

export function docLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return null;
  const [target = ""] = href.split("#");
  if (!/\.(md|json)$/.test(target)) return null;
  const folder = from.split("/").slice(0, -1);
  return target
    .split("/")
    .reduce<string[]>((path, part) => (part === ".." ? path.slice(0, -1) : part === "." ? path : [...path, part]), folder)
    .join("/");
}
