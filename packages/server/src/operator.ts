import { Hono, type Context } from "hono";
import { z } from "zod";
import { TallyError, addDecision, addRepo, answerQuestion, endSession, removeRepo, rowOf, setDefaultRepo, startRecords, type StartDefaults } from "@tally/core";
import { insideWorkspace } from "./folders.ts";
import { operatorOnly } from "./guard.ts";
import type { Hub } from "./hub.ts";

export interface OperatorOptions {
  hub: Hub;
  workspace: string;
  defaults?: StartDefaults;
}

const addSchema = z.object({ root: z.string().min(1), name: z.string().min(1).optional() });
const answerSchema = z.object({ decision: z.string().min(1) });
const decisionSchema = z.object({ id: z.string().min(1), group: z.string().min(1), section: z.string().optional(), text: z.string().min(1), since: z.string().min(1), status: z.string().min(1) });

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new TallyError(`the request does not fit: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

export function operatorRoutes({ hub, workspace, defaults }: OperatorOptions): Hono {
  const api = new Hono();
  const home = hub.repos.home;
  api.post("/repos", async (c) => {
    operatorOnly(c);
    const { root, name } = await body(c, addSchema);
    const folder = await insideWorkspace(workspace, root);
    const started: string[] = [];
    const entry = await addRepo(home, { root: folder, ...(name === undefined ? {} : { name }) }, new Date(), async (checked) => {
      await startRecords(checked, defaults);
      started.push(checked);
    });
    await hub.sync();
    return c.json({ ...entry, started: started.length > 0 });
  });
  api.delete("/repos/:name", async (c) => {
    operatorOnly(c);
    const entry = await removeRepo(home, c.req.param("name"));
    await hub.sync();
    return c.json(entry);
  });
  api.post("/repos/:name/default", async (c) => {
    operatorOnly(c);
    return c.json(await setDefaultRepo(home, c.req.param("name")));
  });
  api.post("/r/:name/operator/sessions/:id/close", async (c) => {
    operatorOnly(c);
    const { repo } = await hub.get(c.req.param("name"));
    return c.json(await endSession(repo, c.req.param("id")));
  });
  api.post("/r/:name/operator/questions/:row/answer", async (c) => {
    operatorOnly(c);
    const row = rowOf(c.req.param("row"));
    const { decision } = await body(c, answerSchema);
    const { repo } = await hub.get(c.req.param("name"));
    return c.json(await answerQuestion(repo, row, decision));
  });
  api.post("/r/:name/operator/decisions", async (c) => {
    operatorOnly(c);
    const { section, ...input } = await body(c, decisionSchema);
    const { repo } = await hub.get(c.req.param("name"));
    return c.json(await addDecision(repo, { ...input, ...(section === undefined ? {} : { section }) }, { operator: true }));
  });
  return api;
}
