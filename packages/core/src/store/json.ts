import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import { TallyError } from "../errors.ts";

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
    throw new TallyError(`${path} does not fit its schema:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}
