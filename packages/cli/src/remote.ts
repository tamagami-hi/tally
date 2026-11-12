import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { TallyError, findRepoRoot, type TicketView } from "@tally/core";
import type { CliAnswer } from "@tally/server";
import { need, parse, splitRepo, text } from "./args.ts";
import type { IO } from "./io.ts";

const HEADERS = { "content-type": "application/json", "x-tally-cli": "1" };
const FILE_OPTIONS = new Set(["--message", "--file", "--config", "--narrative"]);
const SPOOL = ".temp/tally/spool";
const WAIT_SECONDS = 25;

type Landing = TicketView & { repo: string };

const unreachable = (url: string): TallyError => new TallyError(`tally is not reachable at ${url}; start the service, or unset TALLY_URL to work on the files directly`);

async function call<T>(url: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, body === undefined ? { headers: HEADERS } : { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  } catch {
    throw unreachable(url);
  }
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (answer === null) throw new TallyError(`the service at ${url} answered ${response.status} with no reason`);
  if (!response.ok) throw new TallyError(answer.error ?? `the service at ${url} answered ${response.status}`);
  return answer;
}

async function repositoryOf(repoOption: string | undefined, io: IO): Promise<string | undefined> {
  const named = repoOption ?? io.env["TALLY_REPO"];
  if (named !== undefined && named !== "") return resolve(io.cwd, named);
  return findRepoRoot(io.cwd);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function spooled(root: string, path: string): Promise<string> {
  const real = await realpath(path);
  if (!relative(await realpath(root), real).startsWith("..")) return real;
  const target = join(root, SPOOL, `${randomUUID()}-${basename(real)}`);
  await mkdir(join(root, SPOOL), { recursive: true });
  await copyFile(real, target);
  return target;
}

async function withFiles(argv: readonly string[], command: string | undefined, root: string | undefined, io: IO): Promise<string[]> {
  if (root === undefined) return [...argv];
  const sent: string[] = [];
  for (const [index, word] of argv.entries()) {
    const path = resolve(io.cwd, word);
    const named = FILE_OPTIONS.has(argv[index - 1] ?? "") || (command === "import" && index === argv.indexOf("import") + 2);
    sent.push(named && (await isFile(path)) ? await spooled(root, path) : word);
  }
  return sent;
}

function running(command: string, io: IO): Promise<void> {
  return new Promise((done) => {
    const child = spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
    const forward = (emit: (line: string) => void) => (chunk: Buffer): void => {
      for (const line of chunk.toString("utf8").split("\n")) if (line !== "") emit(line);
    };
    child.stdout.on("data", forward(io.out));
    child.stderr.on("data", forward(io.err));
    child.on("error", () => done());
    child.on("close", () => done());
  });
}

async function landRemote(repoOption: string | undefined, argv: readonly string[], io: IO, url: string): Promise<number> {
  const parsed = parse(argv, { message: { type: "string" }, "verified-code": { type: "string" }, milestone: { type: "string" }, task: { type: "string" } });
  const [, ...files] = parsed.positionals;
  const track = need(parsed, 0, "track");
  const messageFile = text(parsed, "message");
  const message = messageFile === undefined ? undefined : await readFile(resolve(io.cwd, messageFile), "utf8").catch(() => {
    throw new TallyError(`the message file does not exist: ${resolve(io.cwd, messageFile)}`);
  });
  let view = await call<Landing>(url, "/api/cli/land", { cwd: io.cwd, repo: repoOption ?? io.env["TALLY_REPO"], track, files, message, verified: text(parsed, "verified-code"), milestone: text(parsed, "milestone"), task: text(parsed, "task") });
  let ran: string | undefined;
  for (;;) {
    if (view.state === "landed") {
      io.out(`${track} landed at ${view.landed?.head ?? ""}`);
      if (view.landed?.recording !== undefined) io.out(view.landed.recording);
      if (view.note !== undefined) io.out(view.note);
      return 0;
    }
    if (view.state === "failed" || view.state === "cancelled") {
      io.err(view.problem ?? `the landing was ${view.state}`);
      return 1;
    }
    if (view.state === "turn" && view.run !== undefined && view.run !== ran) {
      ran = view.run;
      await running(view.run, io);
    } else if (view.state === "queued") {
      io.err(`${track} waits in the landing queue at position ${view.position ?? 0}`);
    }
    view = await call<Landing>(url, `/api/cli/land/${view.repo}/${view.ticket}?after=${view.state}&seconds=${WAIT_SECONDS}`);
  }
}

export async function remoteRun(argv: readonly string[], io: IO, url: string): Promise<number> {
  const base = url.replace(/\/+$/, "");
  const { repo: repoOption, rest } = splitRepo(argv);
  const [command, ...args] = rest;
  if (command === "land") return landRemote(repoOption, args, io, base);
  const sent = await withFiles(argv, command, await repositoryOf(repoOption, io), io);
  const answer = await call<CliAnswer>(base, "/api/cli", { argv: sent, cwd: io.cwd });
  for (const line of answer.out) io.out(line);
  for (const line of answer.err) io.err(line);
  return answer.exit;
}
