import { messageOf } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { builtUnder } from "./under.ts";
import { MAX_NOTE, noteFrom } from "./notes.ts";
import { TALLY } from "./tell.ts";

export async function tellBuiltUnder(repo: Repo, id: string, decision: string, now: Date): Promise<string | undefined> {
  try {
    const built = await builtUnder(repo, id);
    if (built.length === 0) return undefined;
    const text = `${id} is answered by ${decision}: check the work built under its meanwhile against the answer: ${built.join(", ")}`.slice(0, MAX_NOTE);
    const main = repo.config.mainBranch;
    await noteFrom(repo, { track: main, agent: TALLY }, { to: [main], kind: "heads-up", text, about: { record: id } }, now);
    return undefined;
  } catch (error: unknown) {
    return `the work built under ${id} was not named in a note: ${messageOf(error)}`;
  }
}
