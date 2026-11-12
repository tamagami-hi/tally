import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TallyError, appendBuildlog, checksFileSchema, checksFingerprint, readBuildlog, readChecks, renderBuildlog, setChecks } from "@tally/core";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";

export function registerCheckTools(server: McpServer, source: RepoSource): void {
  server.registerTool(
    "checks_get",
    { description: "The code-check record: the fingerprint it was verified at, every check's result, the suites and each module's files, tests, entry points and gaps.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const record = await readChecks(repo);
      if (record === null) throw new TallyError("no checks.json yet; import one with tally import checks");
      return ok(record);
    }),
  );
  server.registerTool(
    "checks_fingerprint",
    { description: "Whether the code-check record stands: its fingerprint against what git log prints for the config's code paths at main.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok(await checksFingerprint(repo))),
  );
  server.registerTool(
    "checks_set",
    { description: "Replace the code-check record whole with measured results; refused unless its fingerprint is what git log prints for the config's code paths at main.", inputSchema: { sessionId: z.string(), record: checksFileSchema } },
    ({ sessionId, record }) => inSession(source, sessionId, async (repo) => {
      return ok(await setChecks(repo, record));
    }),
  );
  server.registerTool(
    "buildlog_append",
    { description: "Add a dated section to a group's build log: what was built, verified, decided and corrected, as Markdown; one section per milestone and group.", inputSchema: { sessionId: z.string(), group: z.string(), milestone: z.string(), title: z.string(), date: z.string(), markdown: z.string(), commits: z.array(z.string()).optional() } },
    ({ sessionId, commits, ...input }) => inSession(source, sessionId, async (repo) => {
      return ok(await appendBuildlog(repo, { ...input, ...(commits === undefined ? {} : { commits }) }));
    }),
  );
  server.registerTool(
    "buildlog_render",
    { description: "A group's build log as the Markdown a reader would have read in build-log.md.", inputSchema: { group: z.string(), ...WHERE } },
    ({ group, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const text = renderBuildlog(await readBuildlog(repo), group);
      return ok({ group, markdown: text }, text);
    }),
  );
}
