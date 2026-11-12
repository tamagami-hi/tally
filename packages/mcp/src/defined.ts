export function defined<T extends Record<string, unknown>>(input: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}
