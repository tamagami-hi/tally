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
