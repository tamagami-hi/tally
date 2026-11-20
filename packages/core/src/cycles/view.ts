import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { openRepo, type Repo } from "../store/records.ts";
import { cycleDir, readCycles } from "./file.ts";

const NO_STATE = ".state";

export async function closedNumbers(recordsDir: string): Promise<number[]> {
  return (await readCycles(recordsDir)).cycles.map((cycle) => cycle.n);
}

export async function cycleView(repo: Repo, n: number): Promise<Repo> {
  if (repo.cycle !== undefined) throw new TallyError("a closed cycle's view does not open another; read it from the current repository");
  const cycles = await readCycles(repo.recordsDir);
  if (n === cycles.current) throw new TallyError(`cycle ${n} is the current cycle: leave \`cycle\` out to read the current cycle`);
  if (!cycles.cycles.some((cycle) => cycle.n === n)) throw new TallyError(`no closed cycle ${n}; the closed cycles are ${cycles.cycles.map((cycle) => cycle.n).join(", ") || "none"}`);
  const folder = cycleDir(repo.recordsDir, n);
  const opened = await openRepo(repo.root, { name: repo.name, stateDir: join(folder, NO_STATE) }, () => folder);
  return { ...opened, cycle: n };
}
