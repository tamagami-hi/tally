import { readFileSync } from "node:fs";
import { TallyError, messageOf } from "@tally/core";
import { z } from "zod";
import { TOOL_META, newestTools } from "./meta.ts";

export interface ServerInfo {
  version: string;
  tools: number;
  newest: string[];
}

const packageSchema = z.object({ version: z.string().min(1) });

const PACKAGE = new URL("../package.json", import.meta.url);

function versionOfPackage(): string {
  try {
    return packageSchema.parse(JSON.parse(readFileSync(PACKAGE, "utf8"))).version;
  } catch (error: unknown) {
    throw new TallyError(`tally's mcp package has no readable version at ${PACKAGE.pathname} (${messageOf(error)}); reinstall or rebuild tally`);
  }
}

export const SERVER_VERSION = versionOfPackage();

export const serverInfo = (): ServerInfo => ({ version: SERVER_VERSION, tools: Object.keys(TOOL_META).length, newest: newestTools() });
