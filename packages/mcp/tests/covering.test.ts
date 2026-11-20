import { describe, expect, test } from "vitest";
import { addDecision } from "../../core/src/records/decisions.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

describe("covering", () => {
  test("is a read that answers what covers a range's files, and refuses a range that would reach git as an option", async () => {
    const made = await cycling();
    const repo = keepingContextAsRecords(made.repo);
    await addDecision(repo, { id: "DEC-1", group: "core", text: "a.txt is the reader's", since: "2026-11-20", status: "in force" }, { operator: true });
    const { call, client } = await connect(repo);

    const answer = await call("covering", { range: `${made.landed}~1..${made.landed}` });
    const refused = await call("covering", { range: "--output=/tmp/x..HEAD" });
    const listed = (await client.listTools()).tools.find((tool) => tool.name === "covering");

    expect(answer.isError, answer.text).toBe(false);
    expect(answer.structured).toMatchObject({ files: ["a.txt"], filesTotal: 1, decisions: [], unplaced: 1 });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("'--output=/tmp/x' is not a commit");
    expect(listed?.annotations).toMatchObject({ readOnlyHint: true });
  });
});
