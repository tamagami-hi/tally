import { z } from "zod";

export const keptFileSchema = z.object({ path: z.string(), sha256: z.string().length(64), bytes: z.number().int().nonnegative() });

export type KeptFile = z.infer<typeof keptFileSchema>;

export type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
