import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TallyError, type CommandPlace } from "@tally/core";
import { z } from "zod";
import { activity } from "./decorators/activity.ts";
import { outcome } from "./decorators/outcome.ts";
import { sharing } from "./decorators/sharing.ts";
import { sized } from "./decorators/sized.ts";
import { annotationsOf, metaOf } from "./meta.ts";
import { paramText } from "./params.ts";
import type { RepoSource } from "./source.ts";

export interface Called {
  tool: string;
  args: Record<string, unknown>;
  params: readonly string[];
  result: CallToolResult;
  source: RepoSource;
  place: CommandPlace;
}

export type Decorator = (called: Called) => Promise<CallToolResult>;

export type ToolHost = Pick<McpServer, "registerTool">;

export const DECORATORS: readonly Decorator[] = [outcome, sharing, activity, sized];

type Handler = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

type Shape = Record<string, z.ZodType>;

interface Config {
  description?: string;
  inputSchema?: Shape;
}

function described(tool: string, shape: Shape): Shape {
  return Object.fromEntries(Object.entries(shape).map(([param, schema]) => {
    const text = schema.description === undefined ? paramText(tool, param) : undefined;
    return [param, text === undefined ? schema : schema.describe(text)];
  }));
}

export function decorating(server: McpServer, source: RepoSource, decorators: readonly Decorator[] = DECORATORS, place: CommandPlace = "service"): ToolHost {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, handler: Handler) => unknown;
  const registerTool = (name: string, config: Config, handler: Handler): unknown => {
    const meta = metaOf(name, place);
    if (meta === undefined) throw new TallyError(`the tool ${name} has no title: add it to the table in meta.ts`);
    const shape = described(name, config.inputSchema ?? {});
    const whole = { ...config, title: meta.title, annotations: annotationsOf(meta), inputSchema: z.strictObject(shape) };
    return register(name, whole, async (args, extra) => {
      let result = await handler(args, extra);
      const given = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
      for (const decorate of decorators) result = await decorate({ tool: name, args: given, params: Object.keys(shape), result, source, place });
      return result;
    });
  };
  return { registerTool: registerTool as McpServer["registerTool"] };
}
