import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { service, type Service } from "./service.test.ts";

const HASH = "0".repeat(64);

async function withLog(s: Service, path: string): Promise<Response> {
  const folder = join(s.alpha.root, "docs/records/evidence");
  await mkdir(folder, { recursive: true });
  const record = { id: "r1", task: "4 manifest", track: "data", agent: "claude", kind: "green", command: ["true"], cwd: s.alpha.root, started: "2026-11-12T10:00:00Z", seconds: 0, exit: 0, log: { path, sha256: HASH, bytes: 1 } };
  await writeFile(join(folder, "B2.json"), JSON.stringify({ schema: 1, milestone: "B2", records: [record] }));
  return s.app.request("/api/r/alpha/evidence/log/r1");
}

describe("a run's log", () => {
  test("is served from inside a track's worktree", async () => {
    const s = await service();
    const log = join(s.alpha.trees["data"] ?? "", ".temp", "run.log");
    await mkdir(join(log, ".."), { recursive: true });
    await writeFile(log, "3 passed\n");

    const response = await withLog(s, log);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("3 passed\n");
  });

  test("is not served when the record points outside the repository", async () => {
    const s = await service();

    const response = await withLog(s, "/etc/hostname");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "that record's log is not inside the repository" });
  });

  test("is not served through a link that leaves the repository", async () => {
    const s = await service();
    const link = join(s.alpha.trees["data"] ?? "", ".temp", "linked.log");
    await mkdir(join(link, ".."), { recursive: true });
    await symlink("/etc/hostname", link);

    const response = await withLog(s, link);

    expect(response.status).toBe(404);
  });
});
