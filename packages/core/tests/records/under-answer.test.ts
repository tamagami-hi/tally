import { describe, expect, test } from "vitest";
import { plan } from "../../src/ledger/ops.ts";
import { readNotes } from "../../src/records/notes.ts";
import { addQuestion, answerQuestion } from "../../src/records/questions.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const asking = (question: string) => ({ group: "core", question, meanwhile: "refuse it meanwhile" });

async function builtUnder() {
  const { repo } = await makeTracked();
  await addQuestion(repo, asking("first"));
  await addQuestion(repo, asking("second"));
  await new Records(repo).update((ledger) => plan(ledger, { milestone: "B2", track: "data", tasks: [{ id: "under one", under: ["Q-1"] }, { id: "under both", under: ["Q-1", "Q-2"] }] }));
  return repo;
}

const aboutQuestion = async (repo: Awaited<ReturnType<typeof builtUnder>>, id: string) => (await readNotes(repo)).notes.filter((note) => note.about?.record === id);

describe("a question answered with work built under it", () => {
  test("posts one note to the main track, from tally, naming the tasks built under it", async () => {
    const repo = await builtUnder();

    await answerQuestion(repo, 1, "DEC-4");

    const notes = await aboutQuestion(repo, "Q-1");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ from: { track: "main", agent: "tally" }, to: ["main"], kind: "heads-up" });
    expect(notes[0]?.text).toBe("Q-1 is answered by DEC-4: check the work built under its meanwhile against the answer: B2 'under one', B2 'under both'");
  });

  test("posts nothing when no task was built under it, and no second note when it is answered again", async () => {
    const repo = await builtUnder();
    await addQuestion(repo, asking("third"));

    await answerQuestion(repo, 3, "DEC-5");
    await answerQuestion(repo, 1, "DEC-4");
    await expect(answerQuestion(repo, 1, "DEC-6")).rejects.toThrow("no open question 1");

    expect(await aboutQuestion(repo, "Q-3")).toEqual([]);
    expect(await aboutQuestion(repo, "Q-1")).toHaveLength(1);
  });
});
