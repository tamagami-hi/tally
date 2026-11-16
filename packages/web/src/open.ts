import type { MilestoneRow, StageRow, StatusData } from "./types.ts";

export interface OpenStage extends StageRow {
  share: number;
  rows: MilestoneRow[];
  finished: number;
  allFinished: boolean;
  reopened: boolean;
}

export interface OpenBoard {
  stages: OpenStage[];
  closedOff: number;
}

const isClosed = (stage: StageRow): boolean => stage.state === "closed";

function openStage(status: StatusData, stage: StageRow): OpenStage {
  const all = status.rows.filter((row) => row.stage === stage.id);
  const rows = all.filter((row) => !row.finished);
  const finished = all.length - rows.length;
  return { ...stage, share: status.stagePct[stage.id] ?? 0, rows, finished, allFinished: all.length > 0 && rows.length === 0, reopened: isClosed(stage) && rows.length > 0 };
}

const isOnBoard = (stage: OpenStage): boolean => !isClosed(stage) || stage.rows.length > 0;

export function openBoard(status: StatusData): OpenBoard {
  const stages = status.stages.map((stage) => openStage(status, stage));
  return { stages: stages.filter(isOnBoard), closedOff: stages.filter((stage) => !isOnBoard(stage)).length };
}

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const finishedLine = (count: number): string => `${counted(count, "finished milestone is", "finished milestones are")} in Done`;

export const closedLine = (count: number): string => `${counted(count, "closed phase is", "closed phases are")} in Done`;

export const closedCount = (count: number): string => `${counted(count, "phase", "phases")} closed`;

export function countsDetail(status: StatusData): string {
  const finished = status.rows.filter((row) => row.finished).length;
  return `${status.rows.length - finished} open · ${finished} finished`;
}
