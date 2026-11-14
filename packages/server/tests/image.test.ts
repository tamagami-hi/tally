import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const DOCKERFILE = new URL("../../../Dockerfile", import.meta.url);

describe("the service's image", () => {
  test("tells tally that its agents run the project's commands, and holds no tool to run them itself", async () => {
    const text = await readFile(DOCKERFILE, "utf8");

    expect(text).toMatch(/^ENV .*\bTALLY_COMMANDS=agent\b/m);
    expect(text).not.toMatch(/docker\.sock|docker-ce|docker\.io/);
  });
});
