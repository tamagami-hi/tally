import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { TallyError, advance, joinQueue, landingTarget, ticketStates, ticketView, trackSession, waitForTicket } from "@tally/core";
import { insideWorkspace } from "./folders.ts";
import { Forbidden } from "./guard.ts";
import type { Hub } from "./hub.ts";

export interface CliLine {
  to: "out" | "err";
  text: string;
}

export interface CliAnswer {
  exit: number;
  lines: CliLine[];
}

export type CliRunner = (argv: string[], cwd: string) => Promise<CliAnswer>;

const HEADER = "x-tally-cli";
const JSON_TYPE = "application/json";
const LOCAL_ONLY = new Set(["serve", "mcp", "land"]);
const MAX_WAIT_SECONDS = 30;
const HELP = new Set(["help", "--help", "-h"]);
const REPO_OPTIONS_WITH_VALUE = new Set(["--name"]);

const runSchema = z.object({ argv: z.array(z.string()), cwd: z.string().min(1) });
const landSchema = z.object({
  cwd: z.string().min(1),
  repo: z.string().optional(),
  track: z.string().min(1),
  files: z.array(z.string()).default([]),
  message: z.string().optional(),
  verified: z.string().optional(),
  milestone: z.string().optional(),
  task: z.string().optional(),
});

function cliOnly(c: Context): void {
  const typed = (c.req.header("content-type") ?? "").toLowerCase().startsWith(JSON_TYPE);
  if (c.req.header(HEADER) === undefined || (c.req.method !== "GET" && !typed)) throw new Forbidden("this is the tally command's own endpoint");
}

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new TallyError(`the request does not fit: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

function split(argv: readonly string[]): { repo: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let repo: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (word === "--repo") {
      repo = argv[index + 1];
      index += 1;
    } else if (word.startsWith("--repo=")) {
      repo = word.slice("--repo=".length);
    } else {
      rest.push(word);
    }
  }
  return { repo, rest };
}

function addedFolder(words: readonly string[]): string | undefined {
  return words.find((word, index) => !word.startsWith("--") && !REPO_OPTIONS_WITH_VALUE.has(words[index - 1] ?? ""));
}

function placeOf(argv: readonly string[], cwd: string): string | undefined {
  const { repo, rest } = split(argv);
  const [command, verb, ...more] = rest;
  if (command === undefined || rest.some((word) => HELP.has(word))) return undefined;
  if (command !== "repo") return resolve(cwd, repo ?? ".");
  const folder = verb === "add" ? addedFolder(more) : undefined;
  return folder === undefined ? undefined : resolve(cwd, folder);
}

export function cliRoutes(hub: Hub, run: CliRunner | undefined, workspace: string): Hono {
  const api = new Hono();
  api.post("/cli", async (c) => {
    cliOnly(c);
    const { argv, cwd } = await body(c, runSchema);
    const [command] = split(argv).rest;
    if (command !== undefined && LOCAL_ONLY.has(command)) return c.json({ exit: 2, lines: [{ to: "err", text: `tally ${command} runs on your own machine, not in the service` }] } satisfies CliAnswer);
    if (run === undefined) throw new TallyError("this service was started without the command line");
    const place = placeOf(argv, cwd);
    if (place !== undefined) await insideWorkspace(workspace, place);
    return c.json(await run(argv, cwd));
  });
  api.post("/cli/land", async (c) => {
    cliOnly(c);
    const { cwd, repo: named, track, files, message, verified, milestone, task } = await body(c, landSchema);
    const repo = await hub.repos.forPath(resolve(cwd, named ?? "."));
    const target = landingTarget(milestone, task);
    const ticket = await joinQueue(repo, trackSession(repo, track, "cli"), {
      files,
      ...(message === undefined ? {} : { message }),
      ...(verified === undefined ? {} : { verified }),
      ...(target === undefined ? {} : { target }),
    });
    await advance(repo);
    return c.json({ repo: repo.name, ...(await ticketView(repo, ticket.id)) });
  });
  api.get("/cli/land/:name/:ticket", async (c) => {
    cliOnly(c);
    const after = z.enum(ticketStates).optional().safeParse(c.req.query("after"));
    const seconds = Math.min(Math.max(Number(c.req.query("seconds") ?? MAX_WAIT_SECONDS) || 1, 1), MAX_WAIT_SECONDS);
    const repo = await hub.repos.get(c.req.param("name"));
    return c.json({ repo: repo.name, ...(await waitForTicket(repo, c.req.param("ticket"), after.success ? after.data : undefined, seconds)) });
  });
  return api;
}
