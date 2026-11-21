import { Hono, type Context } from "hono";
import { EndpointClosed, ROLES, isRole, roleAnswer, type McpEndpoint, type Role } from "@tally/mcp";

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

const MOST_HANDOVERS = 3;

export function serving(at: EndpointAt, role?: Role): (c: Context) => Promise<Response> {
  return async (c) => {
    for (let handed = 0; handed < MOST_HANDOVERS; handed += 1) {
      const endpoint = await at(c, role);
      if (endpoint instanceof Response) return endpoint;
      try {
        return await endpoint.fetch(c.req.raw);
      } catch (error: unknown) {
        if (!(error instanceof EndpointClosed)) throw error;
      }
    }
    throw new EndpointClosed();
  };
}

export function servingRoles(app: Hono, path: string, at: EndpointAt): void {
  for (const role of ROLES) app.all(`${path}/${role}`, serving(at, role));
}
