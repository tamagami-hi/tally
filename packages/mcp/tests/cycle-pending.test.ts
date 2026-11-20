import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { closingPath } from "../../core/src/cycles/file.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { readNotes } from "../../core/src/records/notes.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { holding, isPending, pendingClose } from "../../core/tests/support/pending.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const BUSY = "a cycle close is being finished: try again in a moment; until it is, a tool that writes is refused";
const UNFINISHED = "a cycle close is being finished and could not be finished now:";

async function serving(records = { commit: true }) {
  const made = await cycling(records);
  const repo = keepingContextAsRecords(made.repo);
  const { call } = await connect(repo);
  const operator = await opened(call, made.root, "operator");
  await pendingClose({ repo });
  return { ...made, repo, call, operator };
}

const posting = (operator: string, text: string) => ({ sessionId: operator, to: "all", kind: "heads-up", text });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a tool called while a cycle close is pending", () => {
  test("is refused when it writes and the close is being finished elsewhere, and a read still answers", async () => {
    const { repo, call, operator } = await serving({ commit: false });
    const held = await holding(landingLockPath(repo));

    const written = await call("note_post", posting(operator, "while it closes"));
    const read = await call("board_get", {});
    await held.release();

    expect(written).toMatchObject({ isError: true, text: BUSY });
    expect(read.isError).toBe(false);
    expect((await readNotes(repo)).notes.some((note) => note.text === "while it closes")).toBe(false);
    expect(await isPending(repo)).toBe(true);
  });

  test("finishes the close first when it can, and then does its work", async () => {
    const { repo, call, operator } = await serving();

    const written = await call("note_post", posting(operator, "after the close"));

    expect(written.isError).toBe(false);
    expect(await isPending(repo)).toBe(false);
    expect((await readNotes(repo)).notes.map((note) => note.text)).toContain("after the close");
  });

  test("is refused with the reason when the close cannot be finished, which stderr says too, and a read still answers", async () => {
    const { repo, call, operator } = await serving();
    await writeFile(closingPath(repo.recordsDir, 1), "{ not json");
    const said: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      said.push(String(chunk));
      return true;
    });

    const written = await call("note_post", posting(operator, "while it is broken"));
    const read = await call("board_get", {});

    expect(written.isError).toBe(true);
    expect(written.text).toContain(UNFINISHED);
    expect(written.text).toContain("is not valid JSON");
    expect(read.isError).toBe(false);
    expect(said.join("")).toContain("could not finish the close of cycle");
  });
});
