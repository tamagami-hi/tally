import { Hono, type Context } from "hono";
import { ROLES, isRole, mcpHandler, roleAnswer, type RepoSource, type Role } from "@tally/mcp";
import type { Usage } from "@tally/core";

const NAMED = ROLES.join(" and ");

export function roleRoutes(): Hono {
  const api = new Hono();
  api.get("/roles/:role", (c) => {
    const role = c.req.param("role");
    if (!isRole(role)) return c.json({ error: `no role ${role}; the roles are ${NAMED}` }, 404);
    return c.json(roleAnswer(role));
  });
  return api;
}

export function servingRoles(app: Hono, path: string, source: (c: Context) => Promise<RepoSource | Response>, usage: Usage | undefined): void {
  for (const role of ROLES) {
    app.all(`${path}/${role}`, async (c) => {
      const from = await source(c);
      return from instanceof Response ? from : mcpHandler(from, usage, role as Role)(c.req.raw);
    });
  }
}
