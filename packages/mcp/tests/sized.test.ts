import { describe, expect, test } from "vitest";
import { ANSWER_LIMIT, sized } from "../src/decorators/sized.ts";
import { jsonText, ok } from "../src/respond.ts";
import { oneRepo } from "../src/source.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const row = (n: number) => ({ id: `row-${n}`, text: "x".repeat(400) });
const rows = (count: number) => Array.from({ length: count }, (_, n) => row(n));

async function cut(tool: string, params: readonly string[], value: Record<string, unknown>, text?: string) {
  const { repo } = await makeTracked();
  const result = await sized({ tool, args: {}, params, result: ok(value, text), source: oneRepo(repo) });
  const texts = result.content.map((part) => (part.type === "text" ? part.text : ""));
  return { structured: result.structuredContent as Record<string, unknown>, texts };
}

describe("an answer written as text", () => {
  test("is compact JSON, with no spaces spent on layout", () => {
    expect(ok({ a: 1, b: [1, 2] }).content).toEqual([{ type: "text", text: '{"a":1,"b":[1,2]}' }]);
  });
});

describe("an answer that fits", () => {
  test("is handed back as it came", async () => {
    const value = { decisions: rows(5) };

    const { structured, texts } = await cut("decision_list", ["ids", "group", "limit"], value);

    expect(structured).toEqual(value);
    expect(texts).toEqual([jsonText(value)]);
  });
});

describe("an answer too large to read", () => {
  test("keeps the latest of its longest list, says how many of how many, and names what narrows the tool", async () => {
    const { structured, texts } = await cut("decision_list", ["ids", "group", "limit", "sessionId", "repo"], { decisions: rows(200), replaced: rows(2) });
    const kept = structured["decisions"] as { id: string }[];

    expect(jsonText(structured).length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect(kept.at(-1)?.id).toBe("row-199");
    expect(kept.length).toBeLessThan(200);
    expect(structured["replaced"]).toHaveLength(2);
    expect(structured["truncated"]).toEqual([{ path: "decisions", shown: kept.length, of: 200 }]);
    expect(texts[0]).toBe(jsonText(structured));
    expect(texts[1]).toBe(`This answer was cut to fit ${ANSWER_LIMIT} characters: decisions shows the last ${kept.length} of 200. Narrow it with ids, group or limit.`);
  });

  test("keeps the first of a list whose newest come first", async () => {
    const { structured } = await cut("context_get", ["ids", "limit"], { entries: rows(200), matched: 200 });

    expect((structured["entries"] as { id: string }[])[0]?.id).toBe("row-0");
  });

  test("cuts a long text when there is no list to shorten, in the answer and in the text beside it", async () => {
    const pack = "line\n".repeat(20_000);

    const { structured, texts } = await cut("context_pack", ["level", "track"], { level: "project", text: pack }, pack);

    expect(jsonText(structured).length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect((structured["text"] as string).startsWith("line\nline\n")).toBe(true);
    expect(structured["truncated"]).toEqual([{ path: "text", shown: (structured["text"] as string).length, of: pack.length }]);
    expect(texts[0]?.length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect(texts.at(-1)).toContain("Narrow it with level or track.");
  });

  test("says where the whole of it is when the tool takes nothing that narrows it", async () => {
    const { texts } = await cut("checks_get", ["sessionId", "repo"], { record: { tables: rows(300) } });

    expect(texts.at(-1)).toContain("record.tables shows the last");
    expect(texts.at(-1)).toContain("Nothing narrows this tool: the whole of it is in the repository's docs/records.");
  });

  test("leaves a refusal alone", async () => {
    const { repo } = await makeTracked();
    const refusal = { isError: true, content: [{ type: "text" as const, text: "x".repeat(ANSWER_LIMIT * 2) }] };

    expect(await sized({ tool: "board_get", args: {}, params: [], result: refusal, source: oneRepo(repo) })).toBe(refusal);
  });
});
