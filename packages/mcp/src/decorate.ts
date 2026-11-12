import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { activity } from "./decorators/activity.ts";
import type { RepoSource } from "./source.ts";

export interface Called {
  tool: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  source: RepoSource;
}

export type Decorator = (called: Called) => Promise<CallToolResult>;

export type ToolHost = Pick<McpServer, "registerTool">;

export const DECORATORS: readonly Decorator[] = [activity];

type Handler = (args: unknown, extra: unknown) => CallToolResult | Promise<CallToolResult>;

export function decorating(server: McpServer, source: RepoSource, decorators: readonly Decorator[] = DECORATORS): ToolHost {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, handler: Handler) => unknown;
  const registerTool = (name: string, config: unknown, handler: Handler): unknown =>
    register(name, config, async (args, extra) => {
      let result = await handler(args, extra);
      const given = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
      for (const decorate of decorators) result = await decorate({ tool: name, args: given, result, source });
      return result;
    });
  return { registerTool: registerTool as McpServer["registerTool"] };
}
