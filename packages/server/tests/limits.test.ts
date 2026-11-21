import { describe, expect, test } from "vitest";
import { service } from "./support/service.ts";
import { REVISIONS, requestAt } from "./support/revisions.ts";
import { MOST_BODY_BYTES } from "../../mcp/src/endpoint.ts";

const OVER = "x".repeat(MOST_BODY_BYTES + 1);

const answered = async (response: Response): Promise<[number, unknown]> => [response.status, ((await response.json()) as { error?: unknown }).error];

describe.each(REVISIONS)("the SDK's limits on %s", (revision) => {
  test("a body over 4 MiB is refused with 413, before it is read as a call", async () => {
    const { app } = await service();
    const call = requestAt("/mcp", revision, "tools/call", { name: "decision_list", arguments: { padding: OVER } });

    expect(await answered(await app.request(call))).toEqual([413, { code: -32000, message: `Payload Too Large: Request body must not exceed ${MOST_BODY_BYTES} bytes` }]);
  });

  test("a POST that is not JSON is refused with 415", async () => {
    const { app } = await service();
    const call = requestAt("/mcp", revision, "tools/list", {});
    const plain = new Request(call, { headers: { ...Object.fromEntries(call.headers), "content-type": "text/plain" } });

    expect(await answered(await app.request(plain))).toEqual([415, { code: -32000, message: "Unsupported Media Type: Content-Type must be application/json" }]);
  });
});
