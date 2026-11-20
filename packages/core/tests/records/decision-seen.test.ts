import { describe, expect, test } from "vitest";
import { sessionBrief } from "../../src/context/brief.ts";
import { markDecision, recordDecision } from "../../src/records/decision-record.ts";
import { setStatusBySession } from "../../src/records/decision-status.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { opening } from "../support/opening.ts";

const NOW = new Date("2026-11-21T09:00:00.000Z");
const DISPUTED = "decision DEC-2 (core) is disputed: the operator said it is not their word; replace it with decision_record, or set its status to withdrawn";

async function withTwo() {
  const made = await opening();
  await recordDecision(made.repo, made.operator, { group: "core", text: "JSON only.", said: "JSON only" }, NOW);
  await recordDecision(made.repo, made.operator, { group: "core", text: "No CSV.", said: "no CSV" }, NOW);
  await markDecision(made.repo, { group: "core", id: "DEC-2" }, "dispute", NOW);
  return made;
}

const board = async (made: Awaited<ReturnType<typeof withTwo>>) => collect(made.repo, await new Records(made.repo).readLedger());

describe("decisions to confirm", () => {
  test("the board lists each decision recorded through decision_record and not confirmed, and a disputed one is a problem", async () => {
    const made = await withTwo();

    const status = await board(made);

    expect((status.toConfirm ?? []).map((one) => [one.id, one.said, one.via.agent, one.disputed === true])).toEqual([["DEC-1", "JSON only", "operator", false], ["DEC-2", "no CSV", "operator", true]]);
    expect(status.problems).toContain(DISPUTED);
  });

  test("a confirmed decision leaves the list, and a disputed one withdrawn leaves it and is no problem", async () => {
    const made = await withTwo();
    await markDecision(made.repo, { group: "core", id: "DEC-1" }, "confirm", NOW);
    await setStatusBySession(made.repo, made.operator, { id: "DEC-2", status: "withdrawn: not the operator's" }, NOW);

    const status = await board(made);

    expect((status.toConfirm ?? []).map((one) => one.id)).toEqual([]);
    expect(status.problems).not.toContain(DISPUTED);
  });

  test("an operator session's brief counts the unconfirmed and names the disputed; a track session's says nothing of them", async () => {
    const made = await withTwo();

    const operator = await sessionBrief(made.repo, made.operator, "full");
    const track = await sessionBrief(made.repo, made.data, "full");

    expect(operator.decisions).toEqual({ unconfirmed: 2, disputed: ["DEC-2"] });
    expect(track.decisions).toBeUndefined();
  });
});
