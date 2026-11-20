import { describe, expect, test } from "vitest";
import { markDecision, recordDecision, isUnconfirmed } from "../../src/records/decision-record.ts";
import { addDecision, readDecisions } from "../../src/records/decisions.ts";
import { opening } from "../support/opening.ts";

const NOW = new Date("2026-11-21T09:00:00.000Z");
const SAID = "yes, keep the reader to JSON";

const plain = { group: "core", text: "The reader reads JSON only.", said: SAID };

describe("decision_record", () => {
  test("records the operator's words and the session that wrote them, unconfirmed, under the next DEC id", async () => {
    const { repo, operator } = await opening();

    const { decision } = await recordDecision(repo, operator, plain, NOW);

    expect(decision).toMatchObject({ id: "DEC-1", group: "core", text: plain.text, said: SAID, by: "operator", state: "in force", via: { session: operator.id, track: operator.track, agent: "operator" } });
    expect(decision.confirmed).toBeUndefined();
    expect(isUnconfirmed(decision)).toBe(true);
  });

  test("gives two decisions recorded at once two ids, and keeps both", async () => {
    const { repo, operator } = await opening();

    const [first, second] = await Promise.all([recordDecision(repo, operator, plain, NOW), recordDecision(repo, operator, { ...plain, text: "The writer writes JSON only." }, NOW)]);

    expect(new Set([first.decision.id, second.decision.id])).toEqual(new Set(["DEC-1", "DEC-2"]));
    expect((await readDecisions(repo)).decisions.map((one) => one.id).sort()).toEqual(["DEC-1", "DEC-2"]);
  });

  test("numbers after the highest DEC id in the file, and needs an id where the group's ids are of another form", async () => {
    const { repo, operator } = await opening();
    await addDecision(repo, { id: "DEC-7", group: "core", text: "old", since: "2026-11-01", status: "in force" }, { operator: true });
    await addDecision(repo, { id: "D1", group: "web", text: "old", since: "2026-11-01", status: "in force" }, { operator: true });

    expect((await recordDecision(repo, operator, plain, NOW)).decision.id).toBe("DEC-8");
    await expect(recordDecision(repo, operator, { ...plain, group: "web" }, NOW)).rejects.toThrow("web's decision ids are not all DEC-<n> (D1), so give the id");
  });

  test("refuses an id that exists without replaces, and a replacement keeps the old text and is unconfirmed again", async () => {
    const { repo, operator } = await opening();
    await recordDecision(repo, operator, plain, NOW);
    await markDecision(repo, { group: "core", id: "DEC-1" }, "confirm", NOW);

    await expect(recordDecision(repo, operator, { ...plain, id: "DEC-1" }, NOW)).rejects.toThrow("core already has decision DEC-1; give replaces with why to replace it");
    const { decision, replaced } = await recordDecision(repo, operator, { ...plain, id: "DEC-1", text: "The reader reads JSON and CSV.", said: "add CSV", replaces: { why: "CSV came in" } }, NOW);

    expect(replaced).toMatchObject({ id: "DEC-1", was: plain.text, why: "CSV came in" });
    expect(decision).toMatchObject({ text: "The reader reads JSON and CSV.", said: "add CSV", via: { session: operator.id } });
    expect(decision.confirmed).toBeUndefined();
    expect(decision.disputed).toBeUndefined();
    await expect(recordDecision(repo, operator, { ...plain, id: "DEC-9", replaces: { why: "x" } }, NOW)).rejects.toThrow("core has no decision DEC-9 to replace; its decisions are DEC-1");
  });

  test("refuses a track session, and the operator's words outside 1 to 2,000 characters", async () => {
    const { repo, operator, data } = await opening();

    await expect(recordDecision(repo, data, { ...plain, said: "" }, NOW)).rejects.toThrow("only an operator session records a decision, with the operator's own words in said; a track that needs one decided asks with question_add");
    await expect(recordDecision(repo, operator, { ...plain, said: " " }, NOW)).rejects.toThrow("a decision needs the operator's own words in said");
    await expect(recordDecision(repo, operator, { ...plain, said: "x".repeat(2001) }, NOW)).rejects.toThrow("said holds at most 2000 characters; this one has 2001");
    expect((await readDecisions(repo)).decisions).toEqual([]);
  });
});

describe("confirming a decision", () => {
  test("the later of confirm and dispute wins and clears the other", async () => {
    const { repo, operator } = await opening();
    await recordDecision(repo, operator, plain, NOW);
    const ref = { group: "core", id: "DEC-1" };

    const disputed = await markDecision(repo, ref, "dispute", NOW);
    const confirmed = await markDecision(repo, ref, "confirm", new Date("2026-11-21T10:00:00.000Z"));
    const again = await markDecision(repo, ref, "dispute", new Date("2026-11-21T11:00:00.000Z"));

    expect(disputed.decision).toMatchObject({ disputed: { at: NOW.toISOString() } });
    expect(confirmed.decision).toMatchObject({ confirmed: { at: "2026-11-21T10:00:00.000Z" } });
    expect(confirmed.decision.disputed).toBeUndefined();
    expect(again.decision.confirmed).toBeUndefined();
    expect(isUnconfirmed(again.decision)).toBe(true);
  });

  test("a decision the command line wrote needs no confirming, and an unknown one is refused with the ids there are", async () => {
    const { repo } = await opening();
    const { decision } = await addDecision(repo, { id: "DEC-1", group: "core", text: "by hand", since: "2026-11-01", status: "in force" }, { operator: true });

    expect(decision.via).toBeUndefined();
    expect(isUnconfirmed(decision)).toBe(false);
    await expect(markDecision(repo, { group: "core", id: "DEC-1" }, "confirm", NOW)).rejects.toThrow("decision DEC-1 (core) was not recorded through decision_record, so it needs no confirming");
    await expect(markDecision(repo, { group: "core", id: "DEC-2" }, "dispute", NOW)).rejects.toThrow("core has no decision DEC-2; its decisions are DEC-1");
  });
});
