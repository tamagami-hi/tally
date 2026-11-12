import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Context } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function fileOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function decodable(path: string): boolean {
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
}

export function staticFiles(webDir: string): (c: Context) => Promise<Response> {
  return async (c) => {
    const path = new URL(c.req.url).pathname;
    if (!decodable(path)) return c.text("not found", 404);
    const requested = normalize(decodeURIComponent(path));
    const wanted = requested === "/" || !extname(requested) ? "/index.html" : requested;
    const body = await fileOrNull(join(webDir, wanted));
    if (body === null) return c.text("not found", 404);
    return c.body(new Uint8Array(body), 200, { "content-type": TYPES[extname(wanted)] ?? "application/octet-stream" });
  };
}
