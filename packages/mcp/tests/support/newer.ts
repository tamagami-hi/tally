export const NEWER = "2026-07-28";

export const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": NEWER,
  "io.modelcontextprotocol/clientInfo": { name: "raw", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

const PATIENCE_ON_A_BUSY_MACHINE_MS = 15_000;

export function newerInit(method: string, params: Record<string, unknown>, signal?: AbortSignal, capabilities: Record<string, unknown> = {}): RequestInit {
  const name = typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {};
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-method": method, "mcp-protocol-version": NEWER, ...name },
    body: JSON.stringify({ jsonrpc: "2.0", id: method === "subscriptions/listen" ? "listen:0" : 1, method, params: { ...params, _meta: { ...ENVELOPE, "io.modelcontextprotocol/clientCapabilities": capabilities } } }),
    ...(signal === undefined ? {} : { signal }),
  };
}

export const LISTENING = { notifications: { toolsListChanged: true } };

export async function readUntil(body: ReadableStream<Uint8Array> | null, seen: string): Promise<string> {
  const reader = body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  const deadline = Date.now() + PATIENCE_ON_A_BUSY_MACHINE_MS;
  let text = "";
  while (!text.includes(seen) && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  return text;
}

export async function until(done: () => boolean): Promise<boolean> {
  const deadline = Date.now() + PATIENCE_ON_A_BUSY_MACHINE_MS;
  while (!done() && Date.now() < deadline) await new Promise((next) => setTimeout(next, 10));
  return done();
}
