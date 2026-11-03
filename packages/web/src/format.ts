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
