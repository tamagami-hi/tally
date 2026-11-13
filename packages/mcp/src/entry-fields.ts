import { TallyError, entrySchema, type Entry } from "@tally/core";

const ENTRY_FIELDS = Object.keys(entrySchema.shape);

export function keeping(fields: readonly string[] | undefined): (entry: Entry) => Record<string, unknown> {
  if (fields === undefined) return (entry) => entry;
  const unknown = fields.filter((field) => !ENTRY_FIELDS.includes(field));
  if (unknown.length > 0) throw new TallyError(`an entry has no field ${unknown.map((field) => `'${field}'`).join(", ")}; its fields: ${ENTRY_FIELDS.join(", ")}`);
  return (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => fields.includes(key)));
}
