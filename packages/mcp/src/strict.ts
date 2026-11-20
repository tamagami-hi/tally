import { z } from "zod";

type Def = Record<string, unknown> & { type: string };

interface Cloneable {
  _zod: { def: Def };
  clone: (def: Def) => z.ZodType;
}

const WRAPPED: readonly string[] = ["optional", "nullable", "default", "prefault", "readonly", "nonoptional", "catch"];

const asCloneable = (schema: z.ZodType): Cloneable => schema as unknown as Cloneable;

const takesNo = (keys: readonly string[]) => (issue: { code?: string; keys?: readonly string[] }): string | undefined =>
  issue.code === "unrecognized_keys" ? `takes no ${(issue.keys ?? []).map((key) => `'${key}'`).join(", ")}; it takes ${keys.join(", ")}` : undefined;

export function strictAtEveryDepth(schema: z.ZodType): z.ZodType {
  const { _zod, clone } = asCloneable(schema);
  const def = _zod.def;
  const again = (next: Def): z.ZodType => clone.call(schema, next);
  if (def.type === "object") {
    const shape = Object.fromEntries(Object.entries(def["shape"] as Record<string, z.ZodType>).map(([key, value]) => [key, strictAtEveryDepth(value)]));
    return def["catchall"] === undefined ? again({ ...def, shape, catchall: z.never(), error: takesNo(Object.keys(shape)) }) : again({ ...def, shape });
  }
  if (def.type === "array") return again({ ...def, element: strictAtEveryDepth(def["element"] as z.ZodType) });
  if (def.type === "union") return again({ ...def, options: (def["options"] as z.ZodType[]).map(strictAtEveryDepth) });
  if (def.type === "record") return again({ ...def, valueType: strictAtEveryDepth(def["valueType"] as z.ZodType) });
  if (WRAPPED.includes(def.type)) return again({ ...def, innerType: strictAtEveryDepth(def["innerType"] as z.ZodType) });
  return schema;
}
