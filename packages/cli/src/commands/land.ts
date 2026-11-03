import { resolve } from "node:path";
import { defaultDeps, landTrack, type LandOptions, type Repo } from "@tally/core";
import { need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function landCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { message: { type: "string" }, "verified-code": { type: "string" } });
  const [track, ...files] = parsed.positionals;
  const message = text(parsed, "message");
  const verified = text(parsed, "verified-code");
  const options: LandOptions = {
    track: need(parsed, 0, "track"),
    files,
    ...(message === undefined ? {} : { messageFile: resolve(io.cwd, message) }),
    ...(verified === undefined ? {} : { verifiedCode: verified }),
  };
  void track;
  await landTrack(repo, options, { ...defaultDeps, log: io.out });
  return 0;
}
