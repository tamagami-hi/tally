import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Repo } from "@tally/core";
import { createApp } from "./app.ts";
import { Watcher } from "./watcher.ts";

export interface ServeOptions {
  repo: Repo;
  port: number;
  host: string;
  webDir?: string;
  intervalMs?: number;
}

export interface Running {
  url: string;
  close: () => Promise<void>;
}

export const defaultWebDir = (): string => fileURLToPath(new URL("../../web/dist/", import.meta.url));

export function startServer(options: ServeOptions): Promise<Running> {
  const watcher = new Watcher(options.repo, options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs });
  const app = createApp({ repo: options.repo, watcher, webDir: options.webDir ?? defaultWebDir() });
  return new Promise((done) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: options.host }, (info) => {
      watcher.start();
      done({
        url: `http://${options.host}:${info.port}/`,
        close: async () => {
          await watcher.stop();
          await new Promise<void>((closed) => server.close(() => closed()));
        },
      });
    });
  });
}
