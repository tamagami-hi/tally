import { z } from "zod";
import { MOST_ACCEPT_LINE, MOST_ACCEPT_LINES, underOf, type Repo } from "@tally/core";
import { limitedText } from "./limited.ts";

export const acceptLines = z.array(limitedText(MOST_ACCEPT_LINE, 1, "a line of accept")).max(MOST_ACCEPT_LINES);

const plannedTask = z.object({
  id: z.string().min(1),
  brief: z.string().optional(),
  paths: z.array(z.string().min(1)).optional(),
  covers: z.array(z.string().min(1)).optional(),
  cites: z.array(z.string().min(1)).optional(),
  accept: acceptLines.optional(),
  under: z.array(z.string().min(1)).optional(),
});

export const plannedTasks = z.array(z.union([z.string(), plannedTask])).min(1);

export const citedBy = (tasks: readonly (string | { cites?: readonly string[] | undefined })[]): string[] => tasks.flatMap((task) => (typeof task === "string" ? [] : (task.cites ?? [])));

type Planned = z.infer<typeof plannedTasks>[number];

export const underIn = (repo: Repo, tasks: readonly Planned[]): Promise<Planned[]> => Promise.all(tasks.map(async (task) => (typeof task === "string" || task.under === undefined ? task : { ...task, under: await underOf(repo, task.under) })));
