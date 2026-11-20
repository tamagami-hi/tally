import { finishPendingClose, type Repo } from "@tally/core";
import type { IO } from "./io.ts";

const WRITING: ReadonlySet<string> = new Set(["task", "milestone", "import", "land", "question", "checks", "decision", "buildlog", "records", "report"]);

const READING: Readonly<Record<string, readonly string[]>> = { question: ["list"], checks: ["get", "render", "fingerprint"], decision: ["list"], buildlog: ["render"] };

export const writesRecords = (command: string, args: readonly string[]): boolean => WRITING.has(command) && !(READING[command] ?? []).includes(args[0] ?? "");

export async function finishedFirst(repo: Repo, io: IO): Promise<void> {
  const commit = await finishPendingClose(repo);
  if (commit !== undefined) io.err(`a cycle close left part way was finished first${commit === null ? "" : ` (${commit})`}`);
}
