import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import type { Changed } from "../ledger/ops.ts";
import { configSchema, type Config, type Track } from "../schema/config.ts";
import { ledgerSchema, type Ledger } from "../schema/ledger.ts";
import { STATE_DIR } from "../repos/home.ts";
import { nameFromFolder } from "../repos/name.ts";
import { TRACKS_FILE, type OpenedTrack, type TracksFile } from "../schema/tracks.ts";
import { isOpen, readableTracks } from "../tracks/file.ts";
import { readablePhases } from "../phases/file.ts";
import type { PhasesFile } from "../schema/phases.ts";
import { readJson, writeJsonAtomic } from "./json.ts";
import { withLock } from "./lock.ts";

export const RECORDS_DIR = "docs/records";
export const CONFIG_FILE = "config.json";
export const LEDGER_FILE = "ledger.json";

export interface Repo {
  root: string;
  name: string;
  config: Config;
  recordsDir: string;
  stateDir: string;
  problems?: readonly string[];
}

export const problemOf = (repo: Repo): string | undefined => (repo.problems === undefined || repo.problems.length === 0 ? undefined : repo.problems.join("; "));

export interface Listed {
  name: string;
  stateDir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(from: string): Promise<string | undefined> {
  let current = resolve(from);
  for (;;) {
    if (await exists(join(current, RECORDS_DIR, CONFIG_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const asTrack = ({ name, worktree, branch, parent, paths }: OpenedTrack): Track => ({
  name,
  worktree,
  branch,
  ...(parent === undefined ? {} : { parent }),
  ...(paths === undefined ? {} : { paths }),
});

function withOpenedTracks(config: Config, file: TracksFile): Config {
  const opened = file.tracks.filter(isOpen);
  if (opened.length === 0) return config;
  const listed = new Set(config.tracks.map((track) => track.name));
  const seen = new Set<string>();
  for (const { name } of opened) {
    if (listed.has(name)) throw new TallyError(`track ${name} is in both ${CONFIG_FILE} and ${TRACKS_FILE}; a name lives in one of them, so take it out of ${CONFIG_FILE}`);
    if (seen.has(name)) throw new TallyError(`track ${name} is open twice in ${TRACKS_FILE}; that record is written by tally alone, so restore it from git`);
    seen.add(name);
  }
  return { ...config, tracks: [...config.tracks, ...opened.map(asTrack)] };
}

function withAddedPhases(config: Config, file: PhasesFile): Config {
  const known = new Set(config.stages.map((stage) => stage.id));
  const added = file.phases.flatMap((phase) => (phase.name === undefined || phase.weight === undefined || known.has(phase.id) ? [] : [{ id: phase.id, name: phase.name, weight: phase.weight }]));
  return added.length === 0 ? config : { ...config, stages: [...config.stages, ...added] };
}

export async function openRepo(root: string, listed?: Listed): Promise<Repo> {
  const absolute = resolve(root);
  const config = await readJson(join(absolute, RECORDS_DIR, CONFIG_FILE), configSchema);
  const recordsDir = join(absolute, config.records.dir);
  const tracks = await readableTracks(recordsDir);
  const phases = await readablePhases(recordsDir);
  const problems = [tracks.problem, phases.problem].filter((problem): problem is string => problem !== undefined);
  return {
    root: absolute,
    name: listed?.name ?? nameFromFolder(absolute),
    config: withAddedPhases(withOpenedTracks(config, tracks.value), phases.value),
    recordsDir,
    stateDir: listed?.stateDir ?? join(absolute, STATE_DIR),
    ...(problems.length === 0 ? {} : { problems }),
  };
}

export function reopenRepo(repo: Repo): Promise<Repo> {
  return openRepo(repo.root, { name: repo.name, stateDir: repo.stateDir });
}

export async function initRecords(root: string, config: Config, baseline: string): Promise<Repo> {
  const absolute = resolve(root);
  const configPath = join(absolute, RECORDS_DIR, CONFIG_FILE);
  if (await exists(configPath)) throw new TallyError(`${configPath} already exists`);
  await writeJsonAtomic(configPath, configSchema.parse(config));
  const ledger: Ledger = { schema: 1, baseline, milestones: [], other: [] };
  await writeJsonAtomic(join(absolute, config.records.dir, LEDGER_FILE), ledger);
  return openRepo(absolute);
}

export class Records {
  readonly repo: Repo;
  readonly ledgerPath: string;

  constructor(repo: Repo) {
    this.repo = repo;
    this.ledgerPath = join(repo.recordsDir, LEDGER_FILE);
  }

  readLedger(): Promise<Ledger> {
    return readJson(this.ledgerPath, ledgerSchema);
  }

  writeLedger(ledger: Ledger): Promise<void> {
    return writeJsonAtomic(this.ledgerPath, ledgerSchema.parse(ledger));
  }

  update(change: (ledger: Ledger) => Promise<Changed> | Changed): Promise<string> {
    return withLock(this.ledgerPath, async () => {
      const changed = await change(await this.readLedger());
      await this.writeLedger(changed.ledger);
      return changed.message;
    });
  }

  locked<T>(body: () => Promise<T>): Promise<T> {
    return withLock(this.ledgerPath, body);
  }
}
