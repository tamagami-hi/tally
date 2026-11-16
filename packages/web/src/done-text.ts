import type { DonePart, DoneWork, EndedSession } from "./types.ts";

const MINUTE = 60_000;
const HOUR_MINUTES = 60;
const TWO_DAYS_HOURS = 48;
const DAY_HOURS = 24;

const two = (n: number): string => String(n).padStart(2, "0");

export function dayText(iso: string): string {
  const at = new Date(iso);
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

export function clockText(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

export const momentText = (iso: string): string => `${dayText(iso)} ${clockText(iso)}`;

export function lengthText(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return "under a minute";
  if (minutes < HOUR_MINUTES) return `${minutes} min`;
  const hours = Math.floor(minutes / HOUR_MINUTES);
  if (hours >= TWO_DAYS_HOURS) return `${Math.floor(hours / DAY_HOURS)} days`;
  const rest = minutes % HOUR_MINUTES;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function spanText(from: string, to: string): string {
  const end = dayText(from) === dayText(to) ? clockText(to) : momentText(to);
  return `${clockText(from)} to ${end}, ${lengthText(Date.parse(to) - Date.parse(from))}`;
}

const ENDED: Record<EndedSession["ended"], string> = { closed: "closed", expired: "expired", unknown: "no close recorded" };

export const endedText = (ended: EndedSession["ended"]): string => ENDED[ended];

export const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function countsLine({ phasesClosed, milestonesFinished, tasksLanded }: DoneWork["counts"]): string {
  return [counted(phasesClosed, "phase closed", "phases closed"), counted(milestonesFinished, "milestone finished", "milestones finished"), counted(tasksLanded, "task landed", "tasks landed")].join(" · ");
}

export function partText(part: DonePart): string {
  if (part.state === "parked") return `${part.what}: parked${part.why === undefined ? "" : `, ${part.why}`}`;
  if (part.state === "done") return `${part.what}: done in ${part.to ?? "its task"}`;
  if (part.state === "waiting") return `${part.what}: left to ${part.to ?? "a task"}, not landed yet`;
  return `${part.what}: left to no task`;
}
