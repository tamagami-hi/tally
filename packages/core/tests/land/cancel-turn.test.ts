import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cancelLanding } from "../../src/land/cancel.ts";
import { joinQueue, queueFile, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import type { Repo } from "../../src/store/records.ts";
import { edit } from "../support/landing.ts";
import { landing, ready, runHead, type Queued } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const LIMIT_MS = 40_000;
const started: number[] = [];

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
});

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function atTurn(script: string, stop?: string[]): Promise<Queued & { repo: Repo; ticket: string; script: string }> {
  const q = await ready(script);
  const repo = { ...q.repo, config: { ...q.repo.config, commands: { ...q.repo.config.commands, landing: { ...(stop === undefined ? {} : { stop }) } } } };
  await edit(q.tree, "src/a.rs");
  const ticket = await joinQueue(repo, q.session, landing(["src/a.rs"]));
  await advance(repo);
  const turn = (await queueFile(repo).read()).tickets.find((one) => one.id === ticket.id)?.turn;
  return { ...q, repo, ticket: ticket.id, script: turn?.script ?? "" };
}

function running(script: string, env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const child = execFile("sh", [script], { env }, (error, stdout, stderr) => done({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, output: `${stdout}${stderr}` }));
    if (child.pid !== undefined) started.push(child.pid);
  });
}

const pidIn = async (file: string): Promise<number> => {
  await vi.waitFor(async () => expect((await readFile(file, "utf8").catch(() => "")).trim()).not.toBe(""), { timeout: 10_000, interval: 100 });
  return Number((await readFile(file, "utf8")).trim());
};

async function withoutSetsid(): Promise<NodeJS.ProcessEnv> {
  const bin = await mkdtemp(join(tmpdir(), "tally-bin-"));
  for (const name of await readdir("/usr/bin")) if (name !== "setsid") await symlink(join("/usr/bin", name), join(bin, name));
  return { ...process.env, PATH: bin };
}

describe("a landing cancelled at its turn", () => {
  test("before its first check: the script runs nothing, the commit is undone, and main stays", async () => {
    const q = await atTurn("true");
    const before = await q.main();

    const cancelled = await cancelLanding(q.repo, q.session, q.ticket);
    const ran = await running(q.script);

    expect(cancelled.state).toBe("cancelled");
    expect(ran.code).toBe(3);
    expect(ran.output).toContain("this landing was cancelled at its turn");
    expect(await q.runs()).toEqual([]);
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("A  src/a.rs");
    expect(await q.main()).toBe(before);
  });

  test("during a check: the check and what it started in its group are stopped, and the script's parent goes on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tally-pids-"));
    const q = await atTurn(`sleep 60 & echo $! > ${dir}/child; echo $$ > ${dir}/check; sleep 60`, ["sh", "-c", "echo stop >> \"$RUNS\""]);
    const ran = running(q.script);
    const child = await pidIn(join(dir, "child"));
    const check = await pidIn(join(dir, "check"));

    await cancelLanding(q.repo, q.session, q.ticket);

    await vi.waitFor(() => expect([isAlive(child), isAlive(check)]).toEqual([false, false]), { timeout: 20_000, interval: 200 });
    const done = await ran;
    expect(done.code).toBe(3);
    expect(isAlive(process.pid)).toBe(true);
    expect((await q.runs()).filter((line) => line === "stop")).toEqual(["stop"]);
    expect((await ticketView(q.repo, q.ticket)).state).toBe("cancelled");
  }, LIMIT_MS);

  test("during a check, where no process group can be made: only the check's own process is stopped, and the script says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tally-pids-"));
    const q = await atTurn(`sleep 60 & echo $! > ${dir}/child; sleep 60`);
    const ran = running(q.script, await withoutSetsid());
    const child = await pidIn(join(dir, "child"));
    started.push(child);

    await cancelLanding(q.repo, q.session, q.ticket);

    const done = await ran;
    const log = await readFile((await readdir(join(q.root, ".temp/tally/logs/data"))).map((name) => join(q.root, ".temp/tally/logs/data", name))[0] ?? "", "utf8");
    expect(done.code).toBe(3);
    expect(log).toContain("no process group of its own here (no setsid), so only its own process is stopped; what it started may still run");
  }, LIMIT_MS);

  test("between its last check and the advance of main: main is not advanced", async () => {
    const q = await atTurn("true");
    const before = await q.main();
    expect(await runHead(q.repo)).toBe(0);

    await cancelLanding(q.repo, q.session, q.ticket);
    await advance(q.repo);

    expect((await ticketView(q.repo, q.ticket)).state).toBe("cancelled");
    expect(await q.main()).toBe(before);
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("A  src/a.rs");
  });

  test("after the advance of main: refused, as landed", async () => {
    const q = await atTurn("true");
    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    await expect(cancelLanding(q.repo, q.session, q.ticket)).rejects.toThrow(`ticket ${q.ticket} is landed: main has its commits, so it cannot be cancelled`);
  });

  test("runs the stop command once after a failed turn, and not again when the script runs again", async () => {
    const q = await atTurn("exit 3", ["sh", "-c", "echo stop >> \"$RUNS\""]);

    expect(await runHead(q.repo)).toBe(3);
    await runHead(q.repo);

    expect((await q.runs()).filter((line) => line === "stop")).toEqual(["stop"]);
  });
});
