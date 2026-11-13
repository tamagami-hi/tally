import { messageOf } from "../errors.ts";
import type { Waiter } from "../ledger/waits.ts";
import type { Repo } from "../store/records.ts";
import { MAX_NOTE, noteFrom, type Note } from "./notes.ts";

export const TALLY = "tally";

export interface Told {
  ref: string;
  text: (labels: readonly string[]) => string | Promise<string>;
}

export async function tellWaiters(repo: Repo, from: Note["from"], waiters: readonly Waiter[], told: Told): Promise<string | undefined> {
  const known = new Set([repo.config.mainBranch, ...repo.config.tracks.map((track) => track.name)]);
  const others = waiters.filter((waiter) => waiter.track !== from.track && known.has(waiter.track));
  if (others.length === 0) return undefined;
  try {
    const text = (await told.text(others.map((waiter) => waiter.label))).slice(0, MAX_NOTE);
    await noteFrom(repo, from, { to: [...new Set(others.map((waiter) => waiter.track))], kind: "heads-up", text, about: { task: told.ref } });
    return undefined;
  } catch (error: unknown) {
    return `the tracks waiting on it were not told: ${messageOf(error)}`;
  }
}
