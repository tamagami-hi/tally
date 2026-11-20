import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addQuestion, readQuestions } from "../../core/src/records/questions.ts";
import { plan } from "../../core/src/ledger/ops.ts";
import { readNotes } from "../../core/src/records/notes.ts";
import { Records } from "../../core/src/store/records.ts";
import { readDecisions } from "../../core/src/records/decisions.ts";
import { readRepoList } from "../../core/src/repos/list.ts";
import { listSessions, openSession } from "../../core/src/state/sessions.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { service, type Service } from "./service.test.ts";

const OPERATOR = { "content-type": "application/json", "x-tally-operator": "1" };

const act = (app: Service["app"], method: string, path: string, body?: unknown): Promise<Response> =>
  Promise.resolve(app.request(path, { method, headers: OPERATOR, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe("the operator's list of repositories", () => {
  test("adding a tracked repository lists it and serves its board", async () => {
    const { app, home } = await service();
    const gamma = await makeTracked();

    const response = await act(app, "POST", "/api/repos", { root: gamma.root, name: "gamma" });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ name: "gamma", root: gamma.root, started: false });
    expect((await readRepoList(home)).repos.map((repo) => repo.name)).toEqual(["alpha", "beta", "gamma"]);
    expect((await app.request("/api/r/gamma/snapshot")).status).toBe(200);
  });

  test("adding a repository with no records starts them, and commits that", async () => {
    const { app, workspace } = await service();
    const plain = await makeRepo();
    await sh(plain.root, ["config", "user.name", "tester"]);
    await sh(plain.root, ["config", "user.email", "tester@example.com"]);
    await plain.commit("package.json", "{}", "chore: a package");

    const response = await act(app, "POST", "/api/repos", { root: plain.root, name: "plain" });

    expect(await json(response)).toMatchObject({ name: "plain", started: true });
    const config = JSON.parse(await readFile(join(plain.root, "docs/records/config.json"), "utf8")) as { commands: { test: string[] }; mainBranch: string };
    expect(config.commands.test).toEqual(["npm", "test"]);
    expect(config.mainBranch).toBe("main");
    expect(await sh(plain.root, ["log", "-1", "--format=%s"])).toBe("records: start tracking");
    expect(await sh(plain.root, ["status", "--porcelain"])).toBe("");
    expect(workspace).not.toBe("");
  });

  test("a folder outside the workspace is refused", async () => {
    const { app, workspace } = await service();

    const response = await act(app, "POST", "/api/repos", { root: "/etc", name: "etc" });

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: `/etc is not a folder inside the workspace ${workspace}` });
  });

  test("a folder inside a repository is refused, and nothing is written or committed there", async () => {
    const { app, alpha } = await service();
    await mkdir(join(alpha.root, "src"), { recursive: true });
    const before = await sh(alpha.root, ["rev-parse", "HEAD"]);
    const dirty = await sh(alpha.root, ["status", "--porcelain"]);

    const response = await act(app, "POST", "/api/repos", { root: join(alpha.root, "src"), name: "inner" });

    expect(response.status).toBe(400);
    expect(await sh(alpha.root, ["rev-parse", "HEAD"])).toBe(before);
    expect(await sh(alpha.root, ["status", "--porcelain"])).toBe(dirty);
  });

  test("a name that does not fit is refused before any records are started", async () => {
    const { app } = await service();
    const plain = await makeRepo();
    const before = await plain.head();

    const response = await act(app, "POST", "/api/repos", { root: plain.root, name: "Bad Name" });

    expect(response.status).toBe(400);
    expect(await plain.head()).toBe(before);
    expect(await sh(plain.root, ["status", "--porcelain"])).toBe("");
  });

  test("a name that is taken is refused before any records are started", async () => {
    const { app } = await service();
    const plain = await makeRepo();
    const before = await plain.head();

    const response = await act(app, "POST", "/api/repos", { root: plain.root, name: "alpha" });

    expect(response.status).toBe(400);
    expect(await plain.head()).toBe(before);
  });

  test("a body that is not what the action needs is refused", async () => {
    const { app } = await service();

    const response = await act(app, "POST", "/api/repos", { name: "no-root" });

    expect(response.status).toBe(400);
  });

  test("removing takes a repository off the list and stops serving it", async () => {
    const { app, home } = await service();
    await app.request("/api/r/beta/snapshot");

    const response = await act(app, "DELETE", "/api/repos/beta");

    expect(response.status).toBe(200);
    expect((await readRepoList(home)).repos.map((repo) => repo.name)).toEqual(["alpha"]);
    expect((await app.request("/api/r/beta/snapshot")).status).toBe(404);
  });

  test("picking the default changes where a call that names no repository goes", async () => {
    const { app, home } = await service();

    await act(app, "POST", "/api/repos/beta/default");

    expect((await readRepoList(home)).default).toBe("beta");
  });
});

describe("the folder browser", () => {
  test("lists the workspace's folders and marks repositories, tracked ones and listed ones", async () => {
    const { app, workspace, alpha } = await service();
    const plain = await makeRepo();
    await mkdir(join(workspace, "tally-just-a-folder"), { recursive: true });

    const listing = await json<{ dir: string; parent: string | null; folders: { name: string; path: string; isRepo: boolean; hasRecords: boolean; listed: string | null }[] }>(await app.request("/api/fs"));

    expect(listing.dir).toBe(workspace);
    expect(listing.parent).toBeNull();
    const by = (path: string) => listing.folders.find((folder) => folder.path === path);
    expect(by(alpha.root)).toMatchObject({ isRepo: true, hasRecords: true, listed: "alpha" });
    expect(by(plain.root)).toMatchObject({ isRepo: true, hasRecords: false, listed: null });
    expect(by(join(workspace, "tally-just-a-folder"))).toMatchObject({ isRepo: false, hasRecords: false, listed: null });
  });

  test("goes into a folder and names its parent", async () => {
    const { app, workspace, alpha } = await service();

    const listing = await json<{ dir: string; parent: string | null }>(await app.request(`/api/fs?dir=${encodeURIComponent(alpha.root)}`));

    expect(listing.dir).toBe(alpha.root);
    expect(listing.parent).toBe(workspace);
  });

  test("never leaves the workspace, and says the same of a folder that does not exist", async () => {
    const { app, workspace } = await service();

    const outside = await app.request(`/api/fs?dir=${encodeURIComponent("/etc")}`);
    const missing = await app.request(`/api/fs?dir=${encodeURIComponent("/no/such/folder")}`);

    expect(outside.status).toBe(400);
    expect(await json(outside)).toEqual({ error: `/etc is not a folder inside the workspace ${workspace}` });
    expect(await json(missing)).toEqual({ error: `/no/such/folder is not a folder inside the workspace ${workspace}` });
  });
});

describe("the operator's actions in one repository", () => {
  test("closing a session releases it", async () => {
    const { app, hub, alpha } = await service();
    const repo = await hub.repos.get("alpha");
    const session = await openSession(repo, { worktree: alpha.trees["data"] ?? "", agent: "left-behind" });

    const response = await act(app, "POST", `/api/r/alpha/operator/sessions/${session.id}/close`);

    expect(response.status).toBe(200);
    expect(await listSessions(repo)).toEqual([]);
  });

  test("answering a question records the operator's decision", async () => {
    const { app, hub } = await service();
    const repo = await hub.repos.get("alpha");
    const { question } = await addQuestion(repo, { group: "platform", question: "Which port?", meanwhile: "47560" });

    const response = await act(app, "POST", `/api/r/alpha/operator/questions/${question.row}/answer`, { decision: "Keep 47560." });

    expect(response.status).toBe(200);
    const file = await readQuestions(repo);
    expect(file?.open).toEqual([]);
    expect(file?.answered[0]?.decision).toBe("Keep 47560.");
  });

  test("answering a question with work built under it posts tally's note naming that work, once", async () => {
    const { app, hub } = await service();
    const repo = await hub.repos.get("alpha");
    const { question } = await addQuestion(repo, { group: "platform", question: "Which port?", meanwhile: "47560" });
    const milestone = (await new Records(repo).readLedger()).milestones[0];
    await new Records(repo).update((ledger) => plan(ledger, { milestone: milestone?.id ?? "", track: milestone?.track.split("+")[0] ?? "", tasks: [{ id: "port kept", under: [`Q-${question.row}`] }] }));

    await act(app, "POST", `/api/r/alpha/operator/questions/${question.row}/answer`, { decision: "Keep 47560." });
    const again = await act(app, "POST", `/api/r/alpha/operator/questions/${question.row}/answer`, { decision: "Change it." });

    expect(again.status).toBe(400);
    expect((await readNotes(repo)).notes.filter((note) => note.about?.record === `Q-${question.row}`).map((note) => note.text)).toEqual([`Q-${question.row} is answered by Keep 47560.: check the work built under its meanwhile against the answer: ${milestone?.id ?? ""} 'port kept'`]);
  });

  test("answering a question takes its id as Q-24 too", async () => {
    const { app, hub } = await service();
    const repo = await hub.repos.get("alpha");
    const { question } = await addQuestion(repo, { group: "platform", question: "Which port?", meanwhile: "47560" });

    const response = await act(app, "POST", `/api/r/alpha/operator/questions/Q-${question.row}/answer`, { decision: "Keep 47560." });

    expect(response.status).toBe(200);
    expect((await readQuestions(repo))?.answered[0]?.row).toBe(question.row);
  });

  test("entering a decision records it as the operator's", async () => {
    const { app, hub } = await service();
    const repo = await hub.repos.get("alpha");

    const response = await act(app, "POST", "/api/r/alpha/operator/decisions", { id: "OPS-1", group: "platform", text: "One service for every repository.", since: "2026-11-12", status: "in force" });

    expect(response.status).toBe(200);
    expect((await readDecisions(repo)).decisions.map((d) => [d.id, d.by])).toEqual([["OPS-1", "operator"]]);
  });

  test("an action in one repository leaves the other alone", async () => {
    const { app, hub } = await service();
    await addQuestion(await hub.repos.get("beta"), { group: "platform", question: "Beta's question?", meanwhile: "wait" });

    const response = await act(app, "POST", "/api/r/alpha/operator/questions/1/answer", { decision: "Not alpha's." });

    expect(response.status).toBe(400);
    expect((await readQuestions(await hub.repos.get("beta")))?.open).toHaveLength(1);
  });
});
