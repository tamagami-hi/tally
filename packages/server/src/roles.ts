import { Hono, type Context } from "hono";
import { ROLES, isRole, roleAnswer, type McpEndpoint, type Role } from "@tally/mcp";

const NAMED = ROLES.join(" and ");

export type EndpointAt = (c: Context, role?: Role) => Promise<McpEndpoint | Response>;

export function roleRoutes(): Hono {
  const api = new Hono();
  api.get("/roles/:role", (c) => {
    const role = c.req.param("role");
    if (!isRole(role)) return c.json({ error: `no role ${role}; the roles are ${NAMED}` }, 404);
    return c.json(roleAnswer(role));
  });
  return api;
}

export function serving(at: EndpointAt, role?: Role): (c: Context) => Promise<Response> {
  return async (c) => {
    const endpoint = await at(c, role);
    return endpoint instanceof Response ? endpoint : endpoint.fetch(c.req.raw);
  };
}

export function servingRoles(app: Hono, path: string, at: EndpointAt): void {
  for (const role of ROLES) app.all(`${path}/${role}`, serving(at, role));
}
