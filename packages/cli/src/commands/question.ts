import { TallyError, addQuestion, answerQuestion, editQuestion, questionId, readQuestions, rowOf, type Repo } from "@tally/core";
import { need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

const OPERATOR = { operator: true };
const OPERATOR_AGENT = "operator";

function rowGiven(given: string): number {
  try {
    return rowOf(given);
  } catch {
    throw new TallyError(`the row must be a number or an id such as ${questionId(24)}, not '${given}'`, 2);
  }
}

export async function questionCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "add": {
      const parsed = parse(rest, { group: { type: "string" }, by: { type: "string" } });
      const group = text(parsed, "group");
      if (group === undefined) throw new TallyError("question add needs --group", 2);
      const by = text(parsed, "by");
      const { question, commit } = await addQuestion(repo, { group, question: need(parsed, 0, "the question"), meanwhile: need(parsed, 1, "the conservative behaviour meanwhile"), ...(by === undefined ? {} : { by }) }, OPERATOR);
      io.out(`question ${question.row} (${group}) asked`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "answer": {
      const parsed = parse(rest, {});
      const row = rowGiven(need(parsed, 0, "the row"));
      const { commit } = await answerQuestion(repo, row, need(parsed, 1, "the decision that answers it"));
      io.out(`question ${row} answered`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    case "edit": {
      const parsed = parse(rest, { question: { type: "string" }, meanwhile: { type: "string" }, why: { type: "string" } });
      const why = text(parsed, "why");
      if (why === undefined) throw new TallyError("question edit needs --why", 2);
      const { id, commit } = await editQuestion(repo, { agent: OPERATOR_AGENT, operator: true }, { id: rowGiven(need(parsed, 0, "the question's id")), question: text(parsed, "question"), meanwhile: text(parsed, "meanwhile"), why });
      io.out(`${id} edited`);
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
      throw new TallyError(`tally question: unknown verb '${verb ?? ""}'; use add, answer, edit or list`, 2);
  }
}
