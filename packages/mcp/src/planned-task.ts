import { z } from "zod";
import { MOST_ACCEPT_LINE, MOST_ACCEPT_LINES } from "@tally/core";
import { limitedText } from "./limited.ts";

export const acceptLines = z.array(limitedText(MOST_ACCEPT_LINE, 1, "a line of accept")).max(MOST_ACCEPT_LINES);

const plannedTask = z.object({
  id: z.string().min(1),
  brief: z.string().optional(),
  paths: z.array(z.string().min(1)).optional(),
  covers: z.array(z.string().min(1)).optional(),
  cites: z.array(z.string().min(1)).optional(),
  accept: acceptLines.optional(),
});

export const plannedTasks = z.array(z.union([z.string(), plannedTask])).min(1);

export const citedBy = (tasks: readonly (string | { cites?: readonly string[] | undefined })[]): string[] => tasks.flatMap((task) => (typeof task === "string" ? [] : (task.cites ?? [])));
