import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { readQuestions } from "../../core/src/records/questions.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

function io(cwd: string): IO & { lines: string[]; errors: string[] } {
  const captured = { lines: [] as string[], errors: [] as string[], out: (line: string) => captured.lines.push(line), err: (line: string) => captured.errors.push(line), cwd, env: {}, columns: 120, isTTY: false };
  return captured;
}

describe("tally question", () => {
  test("answer takes a plain row number as before, and says so in the same words", async () => {
    const { repo, root } = await makeTracked();
    const console = io(root);
    await run(["question", "add", "--group", "store", "Keep the cache?", "keep it"], console);

    expect(await run(["question", "answer", "1", "DEC-3"], console)).toBe(0);
    expect(console.lines).toEqual(["question 1 (store) asked", "question 1 answered"]);
    expect((await readQuestions(repo))?.answered.map((one) => one.row)).toEqual([1]);
  });

  test("answer takes an id too", async () => {
    const { root } = await makeTracked();
    const console = io(root);
    await run(["question", "add", "--group", "store", "Keep the cache?", "keep it"], console);

    expect(await run(["question", "answer", "Q-1", "DEC-3"], console)).toBe(0);
  });

  test("edit changes the question and keeps the old words with the why", async () => {
    const { repo, root } = await makeTracked();
    const console = io(root);
    await run(["question", "add", "--group", "store", "Keep the cache?", "keep it"], console);

    expect(await run(["question", "edit", "Q-1", "--question", "Keep the cache as it is?", "--why", "clearer"], console)).toBe(0);

    expect(console.lines.at(-1)).toBe("Q-1 edited");
    expect((await readQuestions(repo))?.open[0]).toMatchObject({ question: "Keep the cache as it is?", edits: [expect.objectContaining({ question: "Keep the cache?", why: "clearer", by: "operator" })] });
  });

  test("edit needs a why", async () => {
    const { root } = await makeTracked();
    const console = io(root);
    await run(["question", "add", "--group", "store", "Keep the cache?", "keep it"], console);

    expect(await run(["question", "edit", "Q-1", "--question", "x"], console)).toBe(2);
    expect(console.errors.at(-1)).toBe("question edit needs --why");
  });
});
