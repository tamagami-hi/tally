import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import type { Changed } from "../ledger/ops.ts";
import { configSchema, type Config } from "../schema/config.ts";
import { ledgerSchema, type Ledger } from "../schema/ledger.ts";
import { readJson, writeJsonAtomic } from "./json.ts";
import { withLock } from "./lock.ts";

export const RECORDS_DIR = "docs/records";
export const CONFIG_FILE = "config.json";
export const LEDGER_FILE = "ledger.json";

export interface Repo {
  root: string;
  config: Config;
  recordsDir: string;
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

export async function openRepo(root: string): Promise<Repo> {
  const absolute = resolve(root);
  const config = await readJson(join(absolute, RECORDS_DIR, CONFIG_FILE), configSchema);
  return { root: absolute, config, recordsDir: join(absolute, config.records.dir) };
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
