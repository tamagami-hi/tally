import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { LiveRepo, Repos, Usage, usagePathOf, type Repo, type StartDefaults } from "@tally/core";
import { SERVER_VERSION } from "@tally/mcp";
import { createApp } from "./app.ts";
import type { CliRunner } from "./cli-api.ts";
import { Endpoints } from "./endpoints.ts";
import { Hub } from "./hub.ts";
import { createServiceApp } from "./service.ts";
import { Watcher } from "./watcher.ts";

const IDLE_SWEEP_MS = 100;
const CUT_AFTER_MS = 500;

interface Listening {
  port: number;
  host: string;
  webDir?: string;
  intervalMs?: number;
  stopGraceMs?: number;
}

export interface ServeOptions extends Listening {
  repo: Repo;
}

export interface ServiceStart extends Listening {
  home: string;
  workspace: string;
  defaults?: StartDefaults;
  cli?: CliRunner;
}

export interface Running {
  url: string;
  close: () => Promise<void>;
}

export const defaultWebDir = (): string => fileURLToPath(new URL("../../web/dist/", import.meta.url));

const interval = (options: Listening): { intervalMs?: number } => (options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs });

function listen(app: Hono, options: Listening, started: () => void, stopping: () => Promise<void>): Promise<Running> {
  return new Promise((done) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: options.host }, (info) => {
      started();
      done({
        url: `http://${options.host}:${info.port}/`,
        close: async () => {
          const closed = new Promise<void>((done) => server.close(() => done()));
          const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
          try {
            await stopping();
            const cut = setTimeout(() => server.closeAllConnections(), CUT_AFTER_MS);
            await closed;
            clearTimeout(cut);
          } finally {
            clearInterval(sweep);
          }
        },
      });
    }) as Server;
  });
}

export async function startServer(options: ServeOptions): Promise<Running> {
  const live = new LiveRepo(options.repo);
  const watcher = new Watcher(() => live.current(), interval(options));
  const usage = await Usage.open(usagePathOf({ stateDir: options.repo.stateDir }), SERVER_VERSION);
  const endpoints = new Endpoints(options.stopGraceMs);
  const app = createApp({ repo: options.repo, watcher, webDir: options.webDir ?? defaultWebDir(), usage, endpoints });
  return listen(app, options, () => {
    watcher.start();
    usage.start();
  }, async () => {
    await endpoints.close();
    await watcher.stop();
    await usage.stop();
  });
}

export async function startService(options: ServiceStart): Promise<Running> {
  const hub = new Hub(new Repos(options.home), interval(options));
  const usage = await Usage.open(usagePathOf({ home: options.home }), SERVER_VERSION);
  const endpoints = new Endpoints(options.stopGraceMs);
  const app = createServiceApp({ hub, webDir: options.webDir ?? defaultWebDir(), workspace: options.workspace, usage, endpoints, ...(options.defaults === undefined ? {} : { defaults: options.defaults }), ...(options.cli === undefined ? {} : { cli: options.cli }) });
  return listen(app, options, () => {
    hub.start();
    usage.start();
  }, async () => {
    await endpoints.close();
    await hub.stop();
    await usage.stop();
  });
}
