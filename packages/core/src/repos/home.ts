import { homedir } from "node:os";
import { join } from "node:path";

export const HOME_ENV = "TALLY_HOME";
export const STATE_DIR = ".temp/tally/state";
export const LIST_FILE = "repos.json";

export function tallyHome(env: NodeJS.ProcessEnv = process.env): string {
  const given = env[HOME_ENV];
  if (given !== undefined && given !== "") return given;
  return join(env["HOME"] ?? homedir(), ".local", "state", "tally");
}

export const listPath = (home: string): string => join(home, LIST_FILE);

export const stateDirOf = (home: string, name: string): string => join(home, "state", name);
