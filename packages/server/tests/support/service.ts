import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach } from "vitest";
import { Hub } from "../../src/hub.ts";
import { createServiceApp } from "../../src/service.ts";
import { addRepo } from "../../../core/src/repos/list.ts";
import { Repos } from "../../../core/src/repos/repos.ts";
import { tmpDir } from "../../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../../core/tests/support/tracked.ts";
import type { Usage } from "../../../core/src/usage/counts.ts";

export interface Service {
  home: string;
  workspace: string;
  hub: Hub;
  app: Hono;
  alpha: Tracked;
  beta: Tracked;
}

const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

export async function service(usage?: Usage): Promise<Service> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  const beta = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  await addRepo(home, { root: beta.root, name: "beta" });
  const web = await tmpDir("tally-web-");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  await writeFile(join(web, "assets", "app.js"), "console.info('tally')");
  const workspace = join(alpha.root, "..");
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  return { home, workspace, hub, app: createServiceApp({ hub, webDir: web, workspace, ...(usage === undefined ? {} : { usage }) }), alpha, beta };
}
