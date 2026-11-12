import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { commitRecords } from "../records/commit.ts";
import { isOperator } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { authorOf, authorSchema, contextDir, type Author } from "./entries.ts";

export const PROJECT_FILE = "project.json";

const PROJECT_FIELDS = ["purpose", "stack", "layout", "glossary"] as const;

export const projectSchema = z.object({
  schema: z.literal(1),
  purpose: z.string().default(""),
  stack: z.array(z.string().min(1)).default([]),
  layout: z.array(z.object({ path: z.string().min(1), what: z.string().min(1) })).default([]),
  glossary: z.array(z.object({ term: z.string().min(1), means: z.string().min(1) })).default([]),
  updated: z.object({ at: z.string(), by: authorSchema }).optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectInput = Partial<Pick<Project, (typeof PROJECT_FIELDS)[number]>>;

export const projectPath = (repo: Repo): string => join(contextDir(repo), PROJECT_FILE);

export async function readProject(repo: Repo): Promise<Project> {
  try {
    return await readJson(projectPath(repo), projectSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, purpose: "", stack: [], layout: [], glossary: [] };
    throw error;
  }
}

function fits(candidate: unknown): Project {
  const parsed = projectSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  throw new TallyError(`the project record would not fit its schema:\n  ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n  ")}`);
}

export async function setProject(repo: Repo, session: Author, input: ProjectInput, now = new Date()): Promise<{ project: Project; commit: string | null }> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session writes the project record; a track that wants a change asks a question with question_add");
  const given = Object.fromEntries(PROJECT_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]));
  if (Object.keys(given).length === 0) throw new TallyError(`the project record needs at least one of ${PROJECT_FIELDS.slice(0, -1).join(", ")} and ${PROJECT_FIELDS.at(-1)}`);
  const path = projectPath(repo);
  const project = await withLock(path, async () => {
    const next = fits({ ...(await readProject(repo)), ...given, updated: { at: now.toISOString(), by: authorOf(session) } });
    await writeJsonAtomic(path, next);
    return next;
  });
  const commit = await commitRecords(repo, `the project record set by ${session.agent}`);
  return { project, commit };
}
