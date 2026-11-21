import type { Context, Hono, MiddlewareHandler } from "hono";
import { NotListed, TallyError, messageOf } from "@tally/core";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const OPERATOR_HEADER = "x-tally-operator";
const JSON_TYPE = "application/json";
const SEALED: readonly (readonly [string, string])[] = [["content-security-policy", "frame-ancestors 'none'"], ["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"]];

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
    if (origin !== undefined && originHost(origin) !== host.toLowerCase()) return c.json({ error: `a page of ${origin} may not call tally` }, 403);
    await next();
    for (const [name, value] of SEALED) c.res.headers.set(name, value);
    return undefined;
  };
}

export function operatorOnly(c: Context): void {
  const marked = c.req.header(OPERATOR_HEADER) !== undefined;
  const typed = (c.req.header("content-type") ?? "").toLowerCase().startsWith(JSON_TYPE);
  if (!marked || !typed) throw new Forbidden("this is the operator's action; it is made from the board");
}

const statusOf = (error: TallyError): 400 | 403 | 404 => (error instanceof NotListed ? 404 : error instanceof Forbidden ? 403 : 400);

export function guarded(app: Hono): Hono {
  app.use("*", loopbackOnly());
  app.onError((error, c) => {
    if (error instanceof TallyError) return c.json({ error: messageOf(error) }, statusOf(error));
    process.stderr.write(`tally failed on ${c.req.method} ${new URL(c.req.url).pathname}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return c.json({ error: "tally failed; the service's log has the detail" }, 500);
  });
  return app;
}
