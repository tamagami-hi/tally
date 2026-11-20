import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TallyError, type CommandPlace, type Usage } from "@tally/core";
import { z } from "zod";
import { countCall } from "./counting.ts";
import { activity } from "./decorators/activity.ts";
import { outcome } from "./decorators/outcome.ts";
import { sharing } from "./decorators/sharing.ts";
import { sized } from "./decorators/sized.ts";
import type { ListedTool } from "./listing.ts";
import { annotationsOf, metaOf } from "./meta.ts";
import { invalidInput, unknownArguments } from "./invalid.ts";
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

export type Decorated = ToolHost & { listed: () => readonly ListedTool[] };

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

export interface Serving {
  decorators?: readonly Decorator[];
  place?: CommandPlace;
  usage?: Usage | undefined;
}

const ANY_INPUT = z.looseObject({});

const objectOf = (args: unknown): Record<string, unknown> => (typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {});

export function decorating(server: McpServer, source: RepoSource, serving: Serving = {}): Decorated {
  const { decorators = DECORATORS, place = "service", usage } = serving;
  const registered: ListedTool[] = [];
  const register = server.registerTool.bind(server) as (name: string, config: unknown, handler: Handler) => unknown;
  const registerTool = (name: string, config: Config, handler: Handler): unknown => {
    const meta = metaOf(name, place);
    if (meta === undefined) throw new TallyError(`the tool ${name} has no title: add it to the table in meta.ts`);
    const shape = described(name, config.inputSchema ?? {});
    const strict = z.strictObject(shape, { error: (issue) => (issue.code === "unrecognized_keys" ? unknownArguments(name, Object.keys(shape), issue.keys) : undefined) });
    const listed = { name, title: meta.title, description: config.description, inputSchema: strict, annotations: annotationsOf(meta) };
    registered.push(listed);
    return register(name, { ...config, title: listed.title, annotations: listed.annotations, inputSchema: ANY_INPUT }, async (args, extra) => {
      const parsed = strict.safeParse(objectOf(args));
      if (!parsed.success) {
        const result = invalidInput(name, parsed.error);
        await countCall(usage, { tool: name, args: objectOf(args), result, source, invalid: true });
        return result;
      }
      const given = parsed.data;
      let result = await handler(given, extra);
      for (const decorate of decorators) result = await decorate({ tool: name, args: given, params: Object.keys(shape), result, source, place });
      await countCall(usage, { tool: name, args: given, result, source });
      return result;
    });
  };
  return { registerTool: registerTool as McpServer["registerTool"], listed: () => [...registered] };
}
