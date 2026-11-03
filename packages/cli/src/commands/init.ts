import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TallyError, configSchema, gitOut, initRecords, type Config } from "@tally/core";
import { parse, text } from "../args.ts";
import type { IO } from "../io.ts";

async function template(root: string, name: string): Promise<Config> {
  const identityName = (await gitOut(root, ["config", "user.name"])) ?? "";
  const identityEmail = (await gitOut(root, ["config", "user.email"])) ?? "";
  if (identityName === "" || identityEmail === "") throw new TallyError("git has no user.name and user.email here; pass --config instead");
  return configSchema.parse({
    schema: 1,
    name,
    tracks: [],
    stages: [],
    commands: { test: ["true"] },
    fingerprint: { paths: ["src"], exclude: ["*.md"] },
    identity: { name: identityName, email: identityEmail },
  });
}

export async function initCommand(root: string, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { name: { type: "string" }, baseline: { type: "string" }, config: { type: "string" } });
  const configFile = text(parsed, "config");
  const baseline = text(parsed, "baseline") ?? (await gitOut(root, ["rev-parse", "--short=7", "HEAD"]));
  if (baseline === null) throw new TallyError("init needs --baseline, since this folder has no commit yet", 2);
  let config: Config;
  if (configFile !== undefined) {
    config = configSchema.parse(JSON.parse(await readFile(resolve(io.cwd, configFile), "utf8")));
  } else {
    const name = text(parsed, "name");
    if (name === undefined) throw new TallyError("init needs --name or --config", 2);
    config = await template(root, name);
  }
  const repo = await initRecords(root, config, baseline);
  io.out(`initialised ${repo.recordsDir} for ${config.name} at baseline ${baseline}`);
  return 0;
}
