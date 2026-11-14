import { readFileSync } from "node:fs";
import { z } from "zod";
import { TOOL_META, newestTools } from "./meta.ts";

export interface ServerInfo {
  version: string;
  tools: number;
  newest: string[];
}

const packageSchema = z.object({ version: z.string().min(1) });

export const SERVER_VERSION = packageSchema.parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))).version;

export const serverInfo = (): ServerInfo => ({ version: SERVER_VERSION, tools: Object.keys(TOOL_META).length, newest: newestTools() });
