import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fingerprint } from "../../src/land/paths.ts";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { commitOn, edit } from "../support/landing.ts";
import { landing, ready } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

describe("a landing on code that was verified already", () => {
  test("lands documentation at once, with no check run", async () => {
    const q = await ready();
    const verified = await fingerprint(q.root, q.repo.config);
    await edit(q.tree, "docs/note.md", "# a note\n");

    const ticket = await joinQueue(q.repo, q.session, landing(["docs/note.md"], { verified }));
    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("landed");
    expect(seen.note).toBe(`landed on the recorded verification of unchanged code ${verified}`);
    expect(await sh(q.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    expect(await q.runs()).toEqual([]);
    expect(await q.head()).toBe(await q.main());
  });

  test("is refused for files that are not documentation", async () => {
    const q = await ready();
    const verified = await fingerprint(q.root, q.repo.config);

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"], { verified }))).rejects.toThrow("--verified-code is only for documentation/evidence on already checked code");
  });

  test("fails when main's code is not the code that was verified", async () => {
    const q = await ready();
    await edit(q.tree, "docs/note.md", "# a note\n");
    const ticket = await joinQueue(q.repo, q.session, landing(["docs/note.md"], { verified: "0000000" }));

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain("main code differs from the verification; task preserved, recheck changed code");
  });

  test("fails when the track carries code beyond what was verified", async () => {
    const q = await ready();
    const verified = await fingerprint(q.root, q.repo.config);
    await commitOn(q.tree, "src/extra.rs", "feat: unverified code");
    await edit(q.tree, "docs/note.md", "# a note\n");
    const ticket = await joinQueue(q.repo, q.session, landing(["docs/note.md"], { verified }));

    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).problem).toContain("track code differs from the verification; task preserved");
  });
});

describe("a landing that touches the records", () => {
  test("is refused: records change through the tools", async () => {
    const q = await ready();
    await mkdir(join(q.tree, "docs/records"), { recursive: true });
    await writeFile(join(q.tree, "docs/records/ledger.json"), "{}\n");
    await sh(q.tree, ["add", "docs/records/ledger.json"]);
    await sh(q.tree, ["commit", "-q", "-m", "chore: a hand edit of the ledger"]);
    const ticket = await joinQueue(q.repo, q.session, { files: [] });

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain("a landing may not change docs/records/ (docs/records/ledger.json); records change through the tools");
  });
});
