import { BARE_HEADERS } from "./wire.ts";
import type { Revision } from "./revisions.ts";
import { ENVELOPE, NEWER } from "../../../mcp/tests/support/newer.ts";

export interface Gated {
  request: Request;
  open: () => void;
}

function headersFor(revision: Revision, method: string, name: string | undefined): Record<string, string> {
  if (revision !== NEWER) return BARE_HEADERS;
  return { ...BARE_HEADERS, "mcp-method": method, "mcp-protocol-version": NEWER, ...(name === undefined ? {} : { "mcp-name": name }) };
}

export function gatedCall(path: string, revision: Revision, method: string, params: Record<string, unknown>): Gated {
  let open = (): void => undefined;
  const gate = new Promise<void>((done) => {
    open = done;
  });
  const meta = revision === NEWER ? { _meta: ENVELOPE } : {};
  const text = JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: { ...params, ...meta } });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await gate;
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const name = typeof params["name"] === "string" ? params["name"] : undefined;
  const init = { method: "POST", headers: headersFor(revision, method, name), body, duplex: "half" } as RequestInit;
  return { request: new Request(`http://127.0.0.1${path}`, init), open };
}
