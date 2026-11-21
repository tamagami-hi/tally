import { afterEach, describe, expect, test, vi } from "vitest";
import { service } from "./support/service.ts";
import { bareSurface, type Surface } from "./support/wire.ts";

const WHOLE: Surface = { tools: 81, characters: 79_623, sha256: "2bdb5a7e90559fd8f5392b56b415d66e8af0f873720c3441bbfc0b66f1ce739d" };
const BUILDER: Surface = { tools: 25, characters: 25_647, sha256: "8b2c8a3c26dc33dd64813d2fc1993723780ba88cf9fc3782ec8ca865c42ae0a6" };
const REVIEWER: Surface = { tools: 15, characters: 18_094, sha256: "c4af8df574faa3746d58091ce079f9ccb4e7904e5d5bb0522ceb36685bb3aa46" };
const WHERE_NO_COMMAND_RUNS: Surface = { tools: 80, characters: 78_313, sha256: "4d1bdd229019ab279434eff92e460ced04ff7ff68b2773541db113ca9324685f" };

const RECORDED_IN_091: readonly (readonly [string, Surface])[] = [
  ["/mcp", WHOLE],
  ["/mcp/builder", BUILDER],
  ["/mcp/reviewer", REVIEWER],
  ["/r/alpha/mcp", WHOLE],
  ["/r/alpha/mcp/builder", BUILDER],
  ["/r/alpha/mcp/reviewer", REVIEWER],
];

const CHANGED = "the tool list changed: a change that is meant updates this fingerprint in the same commit, and the commit says why";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the tool list as 0.9.1 gave it, read over the wire", () => {
  test.each(RECORDED_IN_091)("is the same at %s", async (path, recorded) => {
    const { app } = await service();

    expect(await bareSurface(app, path), CHANGED).toEqual(recorded);
  });

  test("is the same where no command runs, at the whole address and at each role's", async () => {
    vi.stubEnv("TALLY_COMMANDS", "agent");
    const { app } = await service();

    expect(await bareSurface(app, "/mcp"), CHANGED).toEqual(WHERE_NO_COMMAND_RUNS);
    expect(await bareSurface(app, "/r/alpha/mcp"), CHANGED).toEqual(WHERE_NO_COMMAND_RUNS);
    expect(await bareSurface(app, "/mcp/builder"), CHANGED).toEqual(BUILDER);
    expect(await bareSurface(app, "/mcp/reviewer"), CHANGED).toEqual(REVIEWER);
  });
});
