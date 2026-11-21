import { TallyError, messageOf } from "@tally/core";
import { STOP_GRACE_MS, type McpEndpoint, type Role } from "@tally/mcp";

export interface Listed {
  name: string;
  root: string;
}

interface Held {
  listed: Listed | undefined;
  endpoint: McpEndpoint;
}

export class Stopping extends TallyError {
  constructor() {
    super("tally is stopping; call again in a moment, once it is back");
    this.name = "Stopping";
  }
}

const sameListing = (one: Listed | undefined, other: Listed | undefined): boolean => one?.name === other?.name && one?.root === other?.root;

export class Endpoints {
  private held: ReadonlyMap<string, Held> = new Map();
  private stopped = false;
  private readonly graceMs: number;

  constructor(graceMs: number = STOP_GRACE_MS) {
    this.graceMs = graceMs;
  }

  at(address: string, make: () => McpEndpoint, listed?: Listed): McpEndpoint {
    if (this.stopped) throw new Stopping();
    const known = this.held.get(address);
    if (known !== undefined && sameListing(known.listed, listed)) return known.endpoint;
    if (known !== undefined) void this.closing(address, known.endpoint, true);
    const endpoint = make();
    this.held = new Map([...this.held, [address, { listed, endpoint }]]);
    return endpoint;
  }

  async keepListed(roots: ReadonlyMap<string, string>): Promise<void> {
    const kept = (held: Held): boolean => held.listed === undefined || roots.get(held.listed.name) === held.listed.root;
    const gone = [...this.held].filter(([, held]) => !kept(held));
    this.held = new Map([...this.held].filter(([, held]) => kept(held)));
    await Promise.all(gone.map(([address, held]) => this.closing(address, held.endpoint, true)));
  }

  async close(): Promise<void> {
    this.stopped = true;
    const all = [...this.held];
    this.held = new Map();
    await Promise.all(all.map(([address, held]) => this.closing(address, held.endpoint, false)));
  }

  private async closing(address: string, endpoint: McpEndpoint, handOver: boolean): Promise<void> {
    try {
      const left = await endpoint.close({ graceMs: this.graceMs, handOver });
      for (const call of left) process.stderr.write(`tally stopped waiting for ${call} at ${address} after ${this.graceMs} ms; its answer is lost, though it may still finish\n`);
    } catch (error: unknown) {
      process.stderr.write(`tally could not close the MCP handler at ${address}: ${messageOf(error)}\n`);
    }
  }
}

export const addressOf = (path: string, role?: Role): string => (role === undefined ? path : `${path}/${role}`);
