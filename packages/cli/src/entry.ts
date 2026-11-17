import { splitRepo } from "./args.ts";
import { staleWarning, type BuildPlace } from "./build-stamp.ts";
import type { IO } from "./io.ts";
import { run } from "./run.ts";

const REPORTS_ITSELF = "version";

export async function entry(argv: readonly string[], io: IO, place: BuildPlace): Promise<number> {
  if (splitRepo(argv).rest[0] !== REPORTS_ITSELF) {
    const warning = await staleWarning(place);
    if (warning !== undefined) io.err(warning);
  }
  return run(argv, io);
}
