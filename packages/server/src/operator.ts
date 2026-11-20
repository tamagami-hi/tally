import { Hono, type Context } from "hono";
import { z } from "zod";
import { TallyError, addDecision, addRepo, answerQuestion, endSession, finishPendingClose, markDecision, removeRepo, rowOf, setDefaultRepo, startRecords, type Mark, type Repo, type StartDefaults } from "@tally/core";
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

async function writable(hub: Hub, name: string): Promise<Repo> {
  const { repo } = await hub.get(name);
  await finishPendingClose(repo);
  return repo;
}

const MARKS: readonly Mark[] = ["confirm", "dispute"];

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
    return c.json(await endSession(await writable(hub, c.req.param("name")), c.req.param("id")));
  });
  api.post("/r/:name/operator/questions/:row/answer", async (c) => {
    operatorOnly(c);
    const row = rowOf(c.req.param("row"));
    const { decision } = await body(c, answerSchema);
    return c.json(await answerQuestion(await writable(hub, c.req.param("name")), row, decision));
  });
  api.post("/r/:name/operator/decisions", async (c) => {
    operatorOnly(c);
    const { section, ...input } = await body(c, decisionSchema);
    return c.json(await addDecision(await writable(hub, c.req.param("name")), { ...input, ...(section === undefined ? {} : { section }) }, { operator: true }));
  });
  for (const mark of MARKS) {
    const marking = async (c: Context, repo: Repo): Promise<Response> => {
      await finishPendingClose(repo);
      return c.json(await markDecision(repo, { group: c.req.param("group") ?? "", id: c.req.param("id") ?? "" }, mark));
    };
    api.post(`/r/:name/operator/decisions/:group/:id/${mark}`, async (c) => {
      operatorOnly(c);
      return marking(c, (await hub.get(c.req.param("name"))).repo);
    });
    api.post(`/operator/decisions/:group/:id/${mark}`, async (c) => {
      operatorOnly(c);
      return marking(c, (await hub.default()).repo);
    });
  }
  return api;
}
