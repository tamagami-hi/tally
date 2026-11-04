import { z } from "zod";

export const trackSchema = z.object({
  name: z.string().min(1),
  worktree: z.string().min(1),
  branch: z.string().min(1),
  test: z.array(z.string()).min(1).optional(),
  paths: z.array(z.string().min(1)).optional(),
});

export const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  weight: z.number().int().positive(),
});

export const configSchema = z.object({
  schema: z.literal(1),
  name: z.string().min(1),
  mainBranch: z.string().min(1).default("main"),
  docsDir: z.string().min(1).default("docs"),
  extraDocs: z.array(z.string().min(1)).optional(),
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
    })
    .default({ dir: "docs/records", commitPrefix: "records:", commit: true }),
  locks: z.array(z.string().min(1)).default(["landing"]),
});

export type Config = z.infer<typeof configSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Stage = z.infer<typeof stageSchema>;
