import { TallyError, addQuestion, answerQuestion, readQuestions, type Repo } from "@tally/core";
import { need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function questionCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "add": {
      const parsed = parse(rest, { group: { type: "string" }, by: { type: "string" } });
      const group = text(parsed, "group");
      if (group === undefined) throw new TallyError("question add needs --group", 2);
      const by = text(parsed, "by");
      const { question, commit } = await addQuestion(repo, { group, question: need(parsed, 0, "the question"), meanwhile: need(parsed, 1, "the conservative behaviour meanwhile"), ...(by === undefined ? {} : { by }) });
      io.out(`question ${question.row} (${group}) asked`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "answer": {
      const parsed = parse(rest, {});
      const row = Number(need(parsed, 0, "the row"));
      if (!Number.isInteger(row)) throw new TallyError("the row must be a number", 2);
      const { commit } = await answerQuestion(repo, row, need(parsed, 1, "the decision that answers it"));
      io.out(`question ${row} answered`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "list": {
      const file = await readQuestions(repo);
      if (file === null) {
        io.out("no questions.json yet; import one with tally import questions");
        return 0;
      }
      for (const q of file.open) io.out(`${q.row} (${q.group}): ${q.question}`);
      io.out(`next row ${file.nextRow}; answered ${file.answered.length}`);
      return 0;
    }
    default:
      throw new TallyError(`tally question: unknown verb '${verb ?? ""}'; use add, answer or list`, 2);
  }
}
