import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../../src/store/json.ts";
import { tmpDir } from "../support/tmp.ts";

const schema = z.object({ n: z.number() });

describe("the JSON store", () => {
  test("writes a file its reader gives back, making the folders and ending with one newline", async () => {
    const dir = await tmpDir();
    const path = join(dir, "deep", "er", "value.json");
    await writeJsonAtomic(path, { n: 1 });
    expect(await readFile(path, "utf8")).toBe('{\n  "n": 1\n}\n');
    expect(await readJson(path, schema)).toEqual({ n: 1 });
  });

  test("names the file when it is not JSON, and when it does not fit the schema", async () => {
    const dir = await tmpDir();
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{not json");
    await expect(readJson(broken, schema)).rejects.toThrow(/broken\.json.*not valid JSON/s);
    const wrong = join(dir, "wrong.json");
    await writeFile(wrong, '{"n": "one"}');
    await expect(readJson(wrong, schema)).rejects.toThrow(/wrong\.json/);
  });

  test("names a missing file", async () => {
    const dir = await tmpDir();
    await expect(readJson(join(dir, "none.json"), schema)).rejects.toThrow(/none\.json.*does not exist/s);
  });

  test("leaves no temporary file behind", async () => {
    const dir = await tmpDir();
    await writeJsonAtomic(join(dir, "v.json"), { n: 2 });
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(dir)).toEqual(["v.json"]);
  });
});
