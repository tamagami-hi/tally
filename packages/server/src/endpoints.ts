import { TallyError, messageOf, type Usage } from "@tally/core";
import { mcpEndpoint, type McpEndpoint, type RepoSource, type Role } from "@tally/mcp";

export interface Listed {
  name: string;
  root: string;
}

interface Held {
  listed: Listed | undefined;
  endpoint: McpEndpoint;
}

const sameListing = (one: Listed | undefined, other: Listed | undefined): boolean => one?.name === other?.name && one?.root === other?.root;

function closing(endpoint: McpEndpoint): Promise<void> {
  return endpoint.close().catch((error: unknown) => {
    process.stderr.write(`tally could not close an MCP handler: ${messageOf(error)}\n`);
  });
}

export class Endpoints {
  private held: ReadonlyMap<string, Held> = new Map();
  private stopped = false;
  private readonly usage: Usage | undefined;

  constructor(usage?: Usage) {
    this.usage = usage;
  }

  at(address: string, source: () => RepoSource, role?: Role, listed?: Listed): McpEndpoint {
    if (this.stopped) throw new TallyError("tally is stopping; call again once it is back");
    const known = this.held.get(address);
    if (known !== undefined && sameListing(known.listed, listed)) return known.endpoint;
    if (known !== undefined) void closing(known.endpoint);
    const endpoint = mcpEndpoint(source(), this.usage, role);
    this.held = new Map([...this.held, [address, { listed, endpoint }]]);
    return endpoint;
  }

  async keepListed(roots: ReadonlyMap<string, string>): Promise<void> {
    const kept = (held: Held): boolean => held.listed === undefined || roots.get(held.listed.name) === held.listed.root;
    const gone = [...this.held.values()].filter((held) => !kept(held));
    this.held = new Map([...this.held].filter(([, held]) => kept(held)));
    await Promise.all(gone.map((held) => closing(held.endpoint)));
  }

  async close(): Promise<void> {
    this.stopped = true;
    const all = [...this.held.values()];
    this.held = new Map();
    await Promise.all(all.map((held) => closing(held.endpoint)));
  }
}

export const addressOf = (path: string, role?: Role): string => (role === undefined ? path : `${path}/${role}`);
