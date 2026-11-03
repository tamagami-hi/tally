import type { Ledger } from "../schema/ledger.ts";
import { SHORT, knownCommits } from "./items.ts";

export const COVERED = "the ledger covers every commit on main";

export function unrecorded(ledger: Ledger, logLines: readonly string[], ownPrefix?: string): string[] {
  const known = knownCommits(ledger);
  return logLines.filter((line) => {
    const space = line.indexOf(" ");
    const hash = space === -1 ? line : line.slice(0, space);
    const subject = space === -1 ? "" : line.slice(space + 1);
    if (hash.length === 0 || known.has(hash.slice(0, SHORT))) return false;
    return ownPrefix === undefined || !subject.startsWith(ownPrefix);
  });
}
