import { execFileSync, spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAIN = join(ROOT, "packages/cli/dist/main.js");
const NEWER = "2026-07-28";
const OLDER = "2025-03-26";
const ANSWER_MS = 15_000;
const ENVELOPE = { "io.modelcontextprotocol/protocolVersion": NEWER, "io.modelcontextprotocol/clientInfo": { name: "smoke", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };

class SmokeFailed extends Error {}

const started = [];

const check = (holds, what) => {
  if (!holds) throw new SmokeFailed(what);
  process.stdout.write(`ok  ${what}\n`);
};

async function scratchRepository() {
  const root = await mkdtemp(join(tmpdir(), "tally-smoke-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "smoke");
  git("config", "user.email", "smoke@example.invalid");
  git("commit", "-q", "--allow-empty", "-m", "start");
  execFileSync(process.execPath, [MAIN, "--repo", root, "init", "--name", "smoke"], { stdio: "ignore" });
  return root;
}

function serving(root) {
  const child = spawn(process.execPath, [MAIN, "--repo", root, "mcp"], { stdio: ["pipe", "pipe", "ignore"] });
  started.push(child);
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let next = 1;
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const ask = async (method, params) => {
    send({ id: next, method, params });
    next += 1;
    const timer = new Promise((_, failed) => setTimeout(() => failed(new SmokeFailed(`no answer to ${method} within ${ANSWER_MS} ms`)), ANSWER_MS).unref());
    const line = await Promise.race([lines.next(), timer]);
    if (line.done) throw new SmokeFailed(`the command ended before it answered ${method}`);
    return JSON.parse(line.value);
  };
  const end = () => new Promise((done) => {
    child.once("exit", (code) => done(code));
    child.stdin.end();
  });
  return { send, ask, end };
}

const namesOf = (answer) => (answer.result?.tools ?? []).map((tool) => tool.name).sort();

async function onOlder(root) {
  const { send, ask, end } = serving(root);
  const opened = await ask("initialize", { protocolVersion: OLDER, capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  check(opened.result?.protocolVersion === OLDER, `${OLDER}: initialize answers ${OLDER}`);
  send({ method: "notifications/initialized" });
  const names = namesOf(await ask("tools/list", {}));
  check(names.length > 0, `${OLDER}: tools/list answers ${names.length} tools`);
  const read = await ask("tools/call", { name: "board_get", arguments: {} });
  check(read.result !== undefined && read.result.isError !== true, `${OLDER}: board_get answers`);
  check((await end()) === 0, `${OLDER}: the command ends with 0 when its input ends`);
  return names;
}

async function onNewer(root) {
  const { ask, end } = serving(root);
  const discovered = await ask("server/discover", { _meta: ENVELOPE });
  check((discovered.result?.supportedVersions ?? []).includes(NEWER), `${NEWER}: server/discover offers ${NEWER}`);
  const names = namesOf(await ask("tools/list", { _meta: ENVELOPE }));
  check(names.length > 0, `${NEWER}: tools/list answers ${names.length} tools`);
  const read = await ask("tools/call", { name: "board_get", arguments: {}, _meta: ENVELOPE });
  check(read.result !== undefined && read.result.isError !== true, `${NEWER}: board_get answers`);
  const refused = await ask("tools/call", { name: "board_get", arguments: { bogus: 1 }, _meta: ENVELOPE });
  check(refused.result?.isError === true && (refused.result.content?.[0]?.text ?? "").includes("board_get takes no 'bogus'"), `${NEWER}: an unknown argument is refused in tally's words`);
  check((await end()) === 0, `${NEWER}: the command ends with 0 when its input ends`);
  return names;
}

async function smoke() {
  await access(MAIN).catch(() => {
    throw new SmokeFailed(`${MAIN} is missing: run npm run build first`);
  });
  const root = await scratchRepository();
  try {
    const older = await onOlder(root);
    const newer = await onNewer(root);
    check(JSON.stringify(older) === JSON.stringify(newer), "both revisions list the same tools");
  } finally {
    for (const child of started) if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
}

smoke().then(() => process.stdout.write("smoke passed\n"), (error) => {
  process.stderr.write(`smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
