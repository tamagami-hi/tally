import { z } from "zod";

const plannedTask = z.object({
  id: z.string().min(1),
  brief: z.string().optional(),
  paths: z.array(z.string().min(1)).optional(),
  covers: z.array(z.string().min(1)).optional(),
});

export const plannedTasks = z.array(z.union([z.string(), plannedTask])).min(1);
