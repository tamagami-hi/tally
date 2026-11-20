import { describe, expect, test } from "vitest";
import { releasing } from "../../core/tests/support/releasing.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const made = await releasing();
  const { call } = await connect(made.repo);
  return { ...made, call, operatorId: await opened(call, made.root, "operator"), dataId: await opened(call, made.trees["data"]!, "claude") };
}

describe("release_mark and release_list", () => {
  test("an operator session marks a release, and release_list answers it with its tasks and what is unreleased", async () => {
    const made = await serving();
    const one = await made.onMain("src/one.rs", "feat: one");
    await made.landTask("4 manifest", one);

    const marked = await made.call("release_mark", { sessionId: made.operatorId, version: "1.0.0", notes: "the first" });
    const two = await made.onMain("src/two.rs", "feat: two");
    await made.landTask("5 transcoder", two);
    const listed = (await made.call("release_list", {})).structured;

    expect(marked.isError, marked.text).toBe(false);
    expect(marked.structured["release"]).toMatchObject({ version: "1.0.0", commit: one, notes: "the first" });
    expect(listed).toMatchObject({ releases: [{ version: "1.0.0", tasks: { count: 1, milestones: [{ milestone: "B2", ids: ["4 manifest"] }] } }], matched: 1, unreleased: { count: 1, milestones: [{ milestone: "B2", ids: ["5 transcoder"] }] } });
  });

  test("a track session is refused, and a version that is not one is refused by name", async () => {
    const made = await serving();

    const refused = await made.call("release_mark", { sessionId: made.dataId, version: "1.0.0" });
    const bad = await made.call("release_mark", { sessionId: made.operatorId, version: "../x" });

    expect(refused.text).toContain("only an operator session marks a release");
    expect(bad.text).toContain("'../x' is not a version");
  });
});
