import { resolve } from "node:path";
import { defaultDeps, landTrack, landingLog, landingTarget, loggedTests, recordLanding, trackOf, worktreeOf, type LandDeps, type LandOptions, type LandingRecord, type Repo } from "@tally/core";
import { need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

function report({ recorded, message, commit, problem }: LandingRecord, io: IO): void {
  (recorded ? io.out : io.err)(message);
  if (commit !== null) io.out(`records: ${commit}`);
  if (problem !== undefined) io.err(problem);
}

function landingDeps(repo: Repo, track: string, io: IO): LandDeps {
  const deps = { ...defaultDeps, log: io.out };
  if (repo.config.commands.landing === undefined) return deps;
  const log = landingLog(worktreeOf(repo, trackOf(repo.config, track)), track);
  return { ...deps, runTests: loggedTests(log, true) };
}

export async function landCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { message: { type: "string" }, "verified-code": { type: "string" }, milestone: { type: "string" }, task: { type: "string" } });
  const [, ...files] = parsed.positionals;
  const message = text(parsed, "message");
  const verified = text(parsed, "verified-code");
  const target = landingTarget(text(parsed, "milestone"), text(parsed, "task"));
  const options: LandOptions = {
    track: need(parsed, 0, "track"),
    files,
    ...(message === undefined ? {} : { messageFile: resolve(io.cwd, message) }),
    ...(verified === undefined ? {} : { verifiedCode: verified }),
  };
  const landed = await landTrack(repo, options, landingDeps(repo, options.track, io));
  if (target !== undefined) report(await recordLanding(repo, landed, target), io);
  return 0;
}
