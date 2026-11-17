import { describe, expect, test } from "vitest";
import { startService } from "../src/serve.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

describe("starting the service", () => {
  test("listens, lists what the home folder lists, and closes its watchers", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    const running = await startService({ home, workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: root, intervalMs: 50 });

    const health = await (await fetch(`${running.url}api/health`)).json();
    const listed = (await (await fetch(`${running.url}api/repos`)).json()) as { repos: { name: string }[] };
    await running.close();

    expect(health).toMatchObject({ ok: true, version: expect.any(String) });
    expect(listed.repos.map((repo) => repo.name)).toEqual(["alpha"]);
  });

  test("starts with nothing listed, so a repository can be added from the board", async () => {
    const running = await startService({ home: await tmpDir("tally-home-"), workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: await tmpDir("tally-web-"), intervalMs: 50 });

    const listed = (await (await fetch(`${running.url}api/repos`)).json()) as { repos: unknown[] };
    await running.close();

    expect(listed.repos).toEqual([]);
  });
});
