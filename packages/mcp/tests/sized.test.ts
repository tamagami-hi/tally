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

  test("cuts another list before the brief's rules, which are kept whole while anything else can be cut", async () => {
    const brief = { rules: rows(40), entries: rows(30), working: rows(5) };

    const { structured } = await cut("session_open", ["worktree", "agent"], { id: "s1", brief });
    const kept = structured["brief"] as { rules: unknown[]; entries: unknown[] };

    expect(kept.rules).toHaveLength(40);
    expect(kept.entries.length).toBeLessThan(30);
    expect(structured["truncated"]).toEqual([{ path: "brief.entries", shown: kept.entries.length, of: 30 }]);
  });

  test("cuts the protected list as a last resort, when nothing else is left to cut", async () => {
    const { structured } = await cut("session_open", ["worktree", "agent"], { id: "s1", brief: { rules: rows(200) } });

    const kept = (structured["brief"] as { rules: { id: string }[] }).rules;

    expect(jsonText(structured).length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect(kept.length).toBeLessThan(200);
    expect(kept[0]?.id).toBe("row-0");
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

  test("keeps the answer's text readable JSON when another part was added beside it, and leaves that part whole", async () => {
    const { repo } = await makeTracked();
    const answer = { decisions: rows(200) };
    const inbox = "inbox:\n- a note from engine";
    const withInbox = { content: [{ type: "text" as const, text: jsonText(answer) }, { type: "text" as const, text: inbox }], structuredContent: { ...answer, inbox: [{ kind: "note", text: "a note from engine" }] } };

    const result = await sized({ tool: "decision_list", args: {}, params: ["group", "limit"], result: withInbox, source: oneRepo(repo) });
    const texts = result.content.map((part) => (part.type === "text" ? part.text : ""));
    const read = JSON.parse(texts[0] ?? "") as { decisions: unknown[]; truncated: unknown; inbox?: unknown };

    expect(read.decisions).toEqual((result.structuredContent as { decisions: unknown[] }).decisions);
    expect(read.truncated).toEqual((result.structuredContent as { truncated: unknown }).truncated);
    expect(read.inbox).toBeUndefined();
    expect((result.structuredContent as { inbox: unknown[] }).inbox).toHaveLength(1);
    expect(texts[1]).toBe(inbox);
    expect(texts.join("").length).toBeLessThanOrEqual(ANSWER_LIMIT);
  });

  test("counts the parts beside the answer, so the whole of it fits", async () => {
    const { repo } = await makeTracked();
    const answer = { decisions: rows(55) };
    const beside = "inbox:\n" + "- a long note\n".repeat(200);
    const result = await sized({ tool: "decision_list", args: {}, params: ["limit"], result: { content: [{ type: "text", text: jsonText(answer) }, { type: "text", text: beside }], structuredContent: answer }, source: oneRepo(repo) });
    const texts = result.content.map((part) => (part.type === "text" ? part.text : ""));

    expect(jsonText(answer).length).toBeLessThan(ANSWER_LIMIT);
    expect(texts.join("").length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect((result.structuredContent as { decisions: unknown[] }).decisions.length).toBeLessThan(55);
    expect(texts.at(-1)).toContain("decisions shows the last");
  });

  test.each([
    ["hundreds of middling texts", Object.fromEntries(Array.from({ length: 300 }, (_, n) => [`key${n}`, "y".repeat(1_500)]))],
    ["numbers alone", Object.fromEntries(Array.from({ length: 6_000 }, (_, n) => [`key${n}`, n]))],
  ])("says so, and answers little, when nothing in it can be shortened: %s", async (_name, value) => {
    const { structured, texts } = await cut("board_get", ["scope", "fields"], value);
    const size = jsonText(value).length;

    expect(structured).toEqual({ truncated: [{ path: "", shown: 0, of: size }] });
    expect(texts).toEqual([`This answer is ${size} characters, and nothing in it could be cut to fit ${ANSWER_LIMIT}. Narrow it with scope or fields.`]);
  });

  test("keeps a field of the tool's own that is called truncated", async () => {
    const { structured } = await cut("decision_list", ["limit"], { decisions: rows(200), truncated: "the tool's own word" });

    expect(structured["truncated"]).toBe("the tool's own word");
    expect(structured["cut"]).toEqual([{ path: "decisions", shown: (structured["decisions"] as unknown[]).length, of: 200 }]);
  });

  test("leaves a refusal alone", async () => {
    const { repo } = await makeTracked();
    const refusal = { isError: true, content: [{ type: "text" as const, text: "x".repeat(ANSWER_LIMIT * 2) }] };

    expect(await sized({ tool: "board_get", args: {}, params: [], result: refusal, source: oneRepo(repo) })).toBe(refusal);
  });
});
