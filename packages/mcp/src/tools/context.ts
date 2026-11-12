import { z } from "zod";
import { ENTRY_KINDS, MAX_LISTED, MAX_TEXT, MAX_TITLE, TallyError, configureRepo, entrySchema, findEntries, putEntry, readActivity, retireEntry, setProject, type Entry } from "@tally/core";
import { defined } from "../defined.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const DEFAULT_ENTRIES = 50;
const MOST_ENTRIES = 200;
const DEFAULT_EVENTS = 100;
const MOST_EVENTS = 500;
const ENTRY_FIELDS = Object.keys(entrySchema.shape);

function keeping(fields: readonly string[] | undefined): (entry: Entry) => Record<string, unknown> {
  if (fields === undefined) return (entry) => entry;
  const unknown = fields.filter((field) => !ENTRY_FIELDS.includes(field));
  if (unknown.length > 0) throw new TallyError(`an entry has no field ${unknown.map((field) => `'${field}'`).join(", ")}; its fields: ${ENTRY_FIELDS.join(", ")}`);
  return (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => fields.includes(key)));
}

const FILTER = {
  ids: z.array(z.string()).optional().describe("these entries whole, retired or not"),
  kind: z.enum(ENTRY_KINDS).optional(),
  paths: z.array(z.string()).optional().describe("the files you work on; a folder that ends in / or a glob asks for what applies anywhere under it"),
  tags: z.array(z.string()).optional().describe("entries that carry any of these tags"),
  query: z.string().optional().describe("words in the title or the text, in any case"),
  since: z.string().optional().describe("an ISO time: only what was added or retired after it, the retired with it"),
  limit: z.number().int().positive().max(MOST_ENTRIES).default(DEFAULT_ENTRIES),
  fields: z.array(z.string()).optional().describe("keep only these keys of each entry, for example id and title"),
};

export function registerContextTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "context_get",
    { description: "What a session needs to know about this repository, as entries: its rules, conventions, areas, interfaces, how-tos and findings. With no argument, every entry in force, the newest first. An entry with no paths applies everywhere, so `paths` always answers those too. `matched` says how many there were before `limit`.", inputSchema: { ...FILTER, ...WHERE } },
    ({ fields, sessionId, repo: name, ...filter }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const keep = keeping(fields);
      const found = await findEntries(repo, defined(filter));
      return ok({ entries: found.entries.map(keep), matched: found.matched });
    }),
  );
  server.registerTool(
    "context_put",
    {
      description: `Add a context entry: a convention, an area, an interface, a howto or a finding from any session, or a rule from an operator session. An entry is small (a title of at most ${MAX_TITLE} characters, a text of at most ${MAX_TEXT}) and a longer subject is several entries; it holds at most ${MAX_LISTED} each of paths, tags and refs. It is never edited: to change one, add its successor with \`replaces\`, which retires the old one.`,
      inputSchema: {
        sessionId: z.string(),
        kind: z.enum(ENTRY_KINDS),
        title: z.string(),
        text: z.string(),
        paths: z.array(z.string()).optional().describe("files, folders or globs from the repository's root (* within one folder, ** at any depth); leave out for an entry that applies everywhere"),
        tags: z.array(z.string()).optional(),
        refs: z.array(z.string()).optional().describe("other records this one rests on: a decision, a question, a task, another entry"),
        replaces: z.string().optional().describe("the id of the entry this one takes the place of"),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await putEntry(repo, session, defined(input)))),
  );
  server.registerTool(
    "context_retire",
    { description: "Retire a context entry that no longer holds, with the reason. It stays in the record: context_get answers it by its id, and to a reader who asks what changed since a time.", inputSchema: { sessionId: z.string(), id: z.string(), why: z.string() } },
    ({ sessionId, id, why }) => inSession(source, sessionId, async (repo, session) => ok(await retireEntry(repo, session, id, why))),
  );
  server.registerTool(
    "project_set",
    {
      description: "Set the project record (operator session only): the project's purpose, its stack, its layout and its glossary. A field that is given replaces that field, and the others stay.",
      inputSchema: {
        sessionId: z.string(),
        purpose: z.string().optional(),
        stack: z.array(z.string()).optional(),
        layout: z.array(z.object({ path: z.string(), what: z.string() })).optional().describe("each a path and what is there"),
        glossary: z.array(z.object({ term: z.string(), means: z.string() })).optional(),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await setProject(repo, session, defined(input)))),
  );
  server.registerTool(
    "repo_configure",
    { description: "Change the repository's config record (operator session only). `config` holds the keys to set: a top-level key replaces what was there, and `commands` merges one level deep, so setting `commands.test` keeps the rest. The result must fit the config's schema, and a key the schema does not have is refused by name; nothing is written then.", inputSchema: { sessionId: z.string(), config: z.record(z.string(), z.unknown()) } },
    ({ sessionId, config }) => inSession(source, sessionId, async (repo, session) => ok(await configureRepo(repo, session, config))),
  );
  server.registerTool(
    "activity_get",
    {
      description: "What sessions did in this repository, the oldest first: one event for each write a tool made, with when, the session, its track and agent, the tool (`verb`) and what it was aimed at (`target`). Ask with the time you last looked to read what happened while you were away. `matched` says how many there were before `limit`, which keeps the latest. The log is kept only by a repository whose config says `context: \"records\"`.",
      inputSchema: {
        since: z.string().optional().describe("an ISO time: only what came after it"),
        track: z.string().optional().describe("only this track's events"),
        limit: z.number().int().positive().max(MOST_EVENTS).default(DEFAULT_EVENTS),
        ...WHERE,
      },
    },
    ({ sessionId, repo: name, ...filter }) => reading(source, { sessionId, repo: name }, async (repo) => ok(await readActivity(repo, defined(filter)))),
  );
}
