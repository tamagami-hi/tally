import { z } from "zod";

export const trackSchema = z.object({
  name: z.string().min(1),
  worktree: z.string().min(1),
  branch: z.string().min(1),
  test: z.array(z.string()).min(1).optional(),
  paths: z.array(z.string().min(1)).optional(),
  parent: z.string().min(1).optional(),
});

export const checkSchema = z.object({
  name: z.string().min(1),
  command: z.array(z.string()).min(1),
  paths: z.array(z.string().min(1)).min(1),
});

const staysInWorktree = (path: string): boolean => !path.startsWith("/") && !path.split("/").includes("..");

const GIT_DIR = ".git";

const isOwnFolder = (path: string): boolean => staysInWorktree(path) && path.split("/").find((part) => part !== "" && part !== ".") !== GIT_DIR;

export const landingSchema = z.object({
  link: z.array(z.string().min(1).refine(staysInWorktree, "a landing link must be relative to the worktree")).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  weight: z.number().int().positive(),
});

export const CONTEXT_AS_RECORDS = "records";

export const configSchema = z.object({
  schema: z.literal(1),
  name: z.string().min(1),
  mainBranch: z.string().min(1).default("main"),
  docsDir: z.string().min(1).default("docs"),
  extraDocs: z.array(z.string().min(1)).optional(),
  worktreeRoot: z.string().min(1).refine(isOwnFolder, "worktreeRoot is a folder inside the repository, given relative to it, and not under .git").optional(),
  tracks: z.array(trackSchema).superRefine((tracks, context) => {
    const seen = new Set<string>();
    for (const track of tracks) {
      if (seen.has(track.name)) context.addIssue({ code: "custom", message: `track ${track.name} is listed twice` });
      seen.add(track.name);
    }
  }),
  stages: z.array(stageSchema),
  commands: z.object({
    test: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).default({}),
    unset: z.array(z.string()).default([]),
    tmpdir: z.string().optional(),
    landing: landingSchema.optional(),
    checks: z.array(checkSchema).optional(),
  }),
  fingerprint: z.object({
    paths: z.array(z.string()).min(1),
    exclude: z.array(z.string()).default([]),
  }),
  identity: z.object({ name: z.string().min(1), email: z.string().min(1) }),
  records: z
    .object({
      dir: z.string().min(1).default("docs/records"),
      commitPrefix: z.string().min(1).default("records:"),
      commit: z.boolean().default(true),
      batch: z.boolean().optional(),
      commitAt: z.literal("phase").optional(),
    })
    .default({ dir: "docs/records", commitPrefix: "records:", commit: true }),
  locks: z.array(z.string().min(1)).default(["landing"]),
  sessions: z.object({ idleMinutes: z.number().positive() }).optional(),
  worktrees: z.object({ idleMinutes: z.number().positive().optional(), keep: z.boolean().optional() }).optional(),
  context: z.literal(CONTEXT_AS_RECORDS).optional(),
  reviews: z.object({ required: z.boolean(), from: z.string().optional() }).optional(),
});

export type Config = z.infer<typeof configSchema>;

export const keepsContextAsRecords = (config: Pick<Config, "context">): boolean => config.context === CONTEXT_AS_RECORDS;
export type Track = z.infer<typeof trackSchema>;
export type Check = z.infer<typeof checkSchema>;
export type Landing = z.infer<typeof landingSchema>;
export type Stage = z.infer<typeof stageSchema>;
