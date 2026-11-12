export class TallyError extends Error {
  readonly exit: number;

  constructor(message: string, exit = 1) {
    super(message);
    this.name = "TallyError";
    this.exit = exit;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MAX_NAMED = 20;

export function namedList(items: readonly string[], limit = MAX_NAMED): string {
  const shown = items.slice(0, limit).join(", ");
  return items.length > limit ? `${shown} and ${items.length - limit} more` : shown;
}
