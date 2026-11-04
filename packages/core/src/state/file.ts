import type { ZodType } from "zod";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { TallyError } from "../errors.ts";

export class StateFile<T> {
  readonly path: string;
  private readonly schema: ZodType<T>;
  private readonly empty: () => T;

  constructor(path: string, schema: ZodType<T>, empty: () => T) {
    this.path = path;
    this.schema = schema;
    this.empty = empty;
  }

  async read(): Promise<T> {
    try {
      return await readJson(this.path, this.schema);
    } catch (error: unknown) {
      if (error instanceof TallyError && error.message.endsWith("does not exist")) return this.empty();
      throw error;
    }
  }

  update<R>(change: (value: T) => { value: T; result: R } | Promise<{ value: T; result: R }>): Promise<R> {
    return withLock(this.path, async () => {
      const { value, result } = await change(await this.read());
      await writeJsonAtomic(this.path, this.schema.parse(value));
      return result;
    });
  }
}
