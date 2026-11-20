import { describe, expect, test } from "vitest";
import { covering } from "../../src/context/covering.ts";
import { citedRecords } from "../../src/context/order.ts";
import { markDecision, recordDecision } from "../../src/records/decision-record.ts";
import { setStatusBySession } from "../../src/records/decision-status.ts";
import { AT, cycling } from "../support/cycling.ts";

async function marked() {
  const made = await cycling();
  const record = (text: string) => recordDecision(made.repo, made.operator, { group: "core", text, said: text, paths: ["a.txt"] }, AT);
  const unconfirmed = (await record("unconfirmed")).decision.id;
  const disputed = (await record("disputed")).decision.id;
  const confirmed = (await record("confirmed")).decision.id;
  const withdrawn = (await record("withdrawn")).decision.id;
  await markDecision(made.repo, { group: "core", id: disputed }, "dispute", AT);
  await markDecision(made.repo, { group: "core", id: confirmed }, "confirm", AT);
  await setStatusBySession(made.repo, made.operator, { id: withdrawn, status: "withdrawn: not wanted" });
  return { ...made, ids: { unconfirmed, disputed, confirmed, withdrawn } };
}

describe("a decision answered to a builder or a reviewer", () => {
  test("in a work order's cited records carries unconfirmed or disputed, and a withdrawn one says so in changed", async () => {
    const { repo, ids } = await marked();

    const cited = await citedRecords(repo, [ids.unconfirmed, ids.disputed, ids.confirmed, ids.withdrawn]);

    expect(cited.map((one) => ("text" in one ? [one.text, "unconfirmed" in one, "disputed" in one, "changed" in one ? one.changed : undefined] : []))).toEqual([
      ["unconfirmed", true, false, undefined],
      ["disputed", false, true, undefined],
      ["confirmed", false, false, undefined],
      ["withdrawn", false, false, "withdrawn, its status: withdrawn: not wanted"],
    ]);
  });

  test("in covering's decisions carries the same marks", async () => {
    const { repo } = await marked();

    const answer = await covering(repo, { paths: ["a.txt"] });

    expect(answer.decisions.map((one) => [one.text, one.unconfirmed === true, one.disputed === true])).toEqual([["unconfirmed", true, false], ["disputed", false, true], ["confirmed", false, false]]);
  });
});
