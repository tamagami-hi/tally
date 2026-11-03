export const percent = (share: number): string => `${Math.round(share * 100)}%`;

export type Tone = "done" | "active" | "idle" | "warn";

export function tone(share: number): Tone {
  if (share >= 1) return "done";
  if (share > 0) return "active";
  return "idle";
}

export const color: Record<Tone, "grass" | "amber" | "gray" | "tomato"> = { done: "grass", active: "amber", idle: "gray", warn: "tomato" };

export function splitNote(note: string): { kind: "next" | "waits" | "plain"; text: string } {
  const next = /^(.+) next: (.+)$/.exec(note);
  if (next !== null) return { kind: "next", text: `${next[2]} (${next[1]})` };
  const waits = /^(.+): waits for (.+)$/.exec(note);
  if (waits !== null) return { kind: "waits", text: `${waits[1]} waits for ${waits[2]}` };
  return { kind: "plain", text: note };
}
