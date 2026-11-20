import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import { TallyError } from "../errors.ts";

const KNOWN_SCHEMA = 1;

export class UnknownSchema extends TallyError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownSchema";
  }
}

const declaresUnknownSchema = (parsed: unknown): boolean => {
  const declared = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["schema"] : undefined;
  return typeof declared === "number" && declared !== KNOWN_SCHEMA;
};

export async function readJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TallyError(`${path} does not exist`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new TallyError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    const message = `${path} does not fit its schema:\n  ${issues.join("\n  ")}`;
    throw declaresUnknownSchema(parsed) ? new UnknownSchema(message) : new TallyError(message);
  }
  return result.data;
}

export interface Tolerated<T> {
  value: T;
  problem?: string;
}

export const UNREADABLE_TAIL = "; until it is mended the repository reads as if it were empty, and a write that needs it is refused";

export async function tolerated<T>(reading: Promise<T>, empty: T): Promise<Tolerated<T>> {
  try {
    return { value: await reading };
  } catch (error: unknown) {
    if (!(error instanceof TallyError) || error instanceof UnknownSchema) throw error;
    return { value: empty, problem: `${error.message}${UNREADABLE_TAIL}` };
  }
}

export const TEMPORARY_SUFFIX = ".tmp";
const UNIQUE_LENGTH = 8;

async function writeFlushed(path: string, text: string): Promise<void> {
  const handle = await open(path, "w");
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID().slice(0, UNIQUE_LENGTH)}${TEMPORARY_SUFFIX}`;
  try {
    await writeFlushed(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, path);
  } catch (error: unknown) {
    await rm(temporary, { force: true });
    throw error;
  }
}
