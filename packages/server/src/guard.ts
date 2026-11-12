import type { Context, MiddlewareHandler } from "hono";
import { TallyError } from "@tally/core";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const OPERATOR_HEADER = "x-tally-operator";
const JSON_TYPE = "application/json";

export class Forbidden extends TallyError {
  constructor(message: string) {
    super(message);
    this.name = "Forbidden";
  }
}

function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? host);
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function loopbackOnly(): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!LOOPBACK.has(hostnameOf(host))) return c.json({ error: `tally answers only on this machine's loopback address, not ${host}` }, 403);
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      const from = originHost(origin);
      if (from === null || !LOOPBACK.has(hostnameOf(from))) return c.json({ error: `a page of ${origin} may not call tally` }, 403);
    }
    await next();
    return undefined;
  };
}

export function operatorOnly(c: Context): void {
  const marked = c.req.header(OPERATOR_HEADER) !== undefined;
  const typed = (c.req.header("content-type") ?? "").toLowerCase().startsWith(JSON_TYPE);
  if (!marked || !typed) throw new Forbidden("this is the operator's action; it is made from the board");
}
