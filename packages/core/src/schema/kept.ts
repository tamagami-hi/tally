import { z } from "zod";

export const keptFileSchema = z.object({ path: z.string(), sha256: z.string().length(64), bytes: z.number().int().nonnegative() });

export type KeptFile = z.infer<typeof keptFileSchema>;

export const whoSchema = z.looseObject({ track: z.string().min(1), agent: z.string().min(1) });

export type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };

export type Exact<T> = T extends readonly (infer I)[] ? Exact<I>[] : T extends object ? { [K in keyof T as string extends K ? (unknown extends T[K] ? never : K) : number extends K ? never : K]: Exact<T[K]> } : T;
