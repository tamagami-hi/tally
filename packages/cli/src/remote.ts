import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TallyError, findRepoRoot, type TicketView } from "@tally/core";
import type { CliAnswer } from "@tally/server";
import { need, parse, splitRepo, text } from "./args.ts";
import type { IO } from "./io.ts";

const HEADERS = { "content-type": "application/json", "x-tally-cli": "1" };
const FILE_OPTIONS = new Set(["--message", "--file", "--config", "--narrative"]);
const SPOOL = ".temp/tally/spool";
const WAIT_SECONDS = 25;
const MIB = 1024 * 1024;
const MAX_SPOOLED = 8 * MIB;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const IMPORTED_PATH = 2;

interface Sent {
  argv: string[];
  copies: string[];
}

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

function inside(root: string, path: string): boolean {
  const from = relative(root, path);
  return from === "" || (from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from));
}

async function handed(root: string, path: string): Promise<{ path: string; copied: boolean }> {
  const real = await realpath(path);
  if (inside(root, real)) return { path: real, copied: false };
  if ((await stat(real)).size > MAX_SPOOLED) throw new TallyError(`${real} is larger than ${MAX_SPOOLED / MIB} MiB, too large to hand to the service; put it inside the repository`);
  const target = join(root, SPOOL, `${randomUUID()}-${basename(real)}`);
  await mkdir(join(root, SPOOL), { recursive: true });
  await copyFile(real, target);
  return { path: target, copied: true };
}

const removed = (copies: readonly string[]): Promise<unknown> => Promise.all(copies.map((copy) => rm(copy, { force: true })));

function commandIndex(argv: readonly string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (word === "--repo") index += 1;
    else if (!word.startsWith("--repo=")) return index;
  }
  return -1;
}

async function withFiles(argv: readonly string[], root: string | undefined, io: IO): Promise<Sent> {
  const real = root === undefined ? undefined : await realpath(root).catch(() => undefined);
  if (real === undefined) return { argv: [...argv], copies: [] };
  const at = commandIndex(argv);
  const imported = argv[at] === "import" ? at + IMPORTED_PATH : -1;
  const sent: string[] = [];
  const copies: string[] = [];
  try {
    for (const [index, word] of argv.entries()) {
      const path = resolve(io.cwd, word);
      const named = FILE_OPTIONS.has(argv[index - 1] ?? "") || index === imported;
      if (!named || !(await isFile(path))) {
        sent.push(word);
        continue;
      }
      const file = await handed(real, path);
      sent.push(file.path);
      if (file.copied) copies.push(file.path);
    }
  } catch (error: unknown) {
    await removed(copies);
    throw error;
  }
  return { argv: sent, copies };
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

function serviceAt(url: string): string {
  const host = URL.canParse(url) ? new URL(url).hostname : undefined;
  if (host === undefined) throw new TallyError(`TALLY_URL is not an address: ${url}`, 2);
  if (!LOOPBACK.has(host)) throw new TallyError(`TALLY_URL must name this machine's loopback address (127.0.0.1, localhost or [::1]), not ${host}`, 2);
  return url.replace(/\/+$/, "");
}

export async function remoteRun(argv: readonly string[], io: IO, url: string): Promise<number> {
  const base = serviceAt(url);
  const { repo: repoOption, rest } = splitRepo(argv);
  const [command, ...args] = rest;
  if (command === "land") return landRemote(repoOption, args, io, base);
  const root = await repositoryOf(repoOption, io);
  const fromEnv = repoOption === undefined ? io.env["TALLY_REPO"] : undefined;
  const { argv: sent, copies } = await withFiles(argv, root, io);
  try {
    const named = fromEnv === undefined || fromEnv === "" ? sent : ["--repo", resolve(io.cwd, fromEnv), ...sent];
    const answer = await call<CliAnswer>(base, "/api/cli", { argv: named, cwd: io.cwd });
    for (const line of answer.lines) (line.to === "out" ? io.out : io.err)(line.text);
    return answer.exit;
  } finally {
    await removed(copies);
  }
}
