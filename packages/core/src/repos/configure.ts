import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { commitRecords } from "../records/commit.ts";
import { configSchema, type Config } from "../schema/config.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { CONFIG_FILE, RECORDS_DIR, type Repo } from "../store/records.ts";

type Keyed = Record<string, unknown>;

const MERGED_ONE_LEVEL = "commands";

const keyedSchema = z.record(z.string(), z.unknown());

const isKeyed = (value: unknown): value is Keyed => typeof value === "object" && value !== null && !Array.isArray(value);

function merged(current: Keyed, given: Keyed): Keyed {
  const before = current[MERGED_ONE_LEVEL];
  const after = given[MERGED_ONE_LEVEL];
  return { ...current, ...given, ...(isKeyed(before) && isKeyed(after) ? { [MERGED_ONE_LEVEL]: { ...before, ...after } } : {}) };
}

function dropped(given: unknown, kept: unknown, at = ""): string[] {
  if (Array.isArray(given)) return given.flatMap((item, index) => dropped(item, Array.isArray(kept) ? kept[index] : undefined, `${at}[${index}]`));
  if (!isKeyed(given) || !isKeyed(kept)) return [];
  return Object.entries(given).flatMap(([key, value]) => {
    const path = at === "" ? key : `${at}.${key}`;
    return Object.hasOwn(kept, key) ? dropped(value, kept[key], path) : [path];
  });
}

function fitted(candidate: Keyed, given: Keyed): Config {
  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new TallyError(`the config would not fit its schema, so nothing was written:\n  ${issues.join("\n  ")}`);
  }
  const lost = dropped(given, parsed.data);
  if (lost.length > 0) throw new TallyError(`the config has no place for ${lost.map((key) => `'${key}'`).join(", ")}; nothing was written. Its keys: ${Object.keys(configSchema.shape).join(", ")}`);
  return parsed.data;
}

export async function configureRepo(repo: Repo, session: Pick<Session, "track" | "agent">, given: Keyed): Promise<{ config: Config; changed: string[]; commit: string | null }> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session changes the config; a track that wants a change asks a question with question_add");
  const changed = Object.keys(given);
  if (changed.length === 0) throw new TallyError("changing the config needs at least one of its keys");
  const path = join(repo.root, RECORDS_DIR, CONFIG_FILE);
  const config = await withLock(path, async () => {
    const next = fitted(merged(await readJson(path, keyedSchema), given), given);
    await writeJsonAtomic(path, next);
    return next;
  });
  const commit = await commitRecords(repo, `config changed by ${session.agent}: ${changed.join(", ")}`);
  return { config, changed, commit };
}
