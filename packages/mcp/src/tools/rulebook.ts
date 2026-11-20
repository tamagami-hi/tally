import { z } from "zod";
import { MAX_LISTED, MAX_SOURCE, MAX_TEXT, MAX_TITLE, RULE_SECTIONS, adoptRulebook, readRulebook, tailorRule } from "@tally/core";
import { defined } from "../defined.ts";
import { keeping } from "../entry-fields.ts";
import { limitedText } from "../limited.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerRulebookTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "rulebook_get",
    {
      description: "The rules in force, in rulebook order: authority, safety, working, then doing each thing once; breaking a `safety` rule fails the work whatever the tests say. `waiting: true` keeps the rules that still carry `tailor`, a question this project has to answer. `template.notAdopted` names the template's rules this repository never had.",
      inputSchema: {
        section: z.enum(RULE_SECTIONS).optional().describe("only this section's rules"),
        waiting: z.boolean().optional().describe("true keeps only the rules that still carry a question for the project"),
        fields: z.array(z.string()).optional(),
        ...WHERE,
      },
    },
    ({ section, waiting, fields, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const keep = keeping(fields);
      const read = await readRulebook(repo, defined({ section, waiting }));
      return ok({ ...read, rules: read.rules.map(keep) });
    }),
  );
  server.registerTool(
    "rulebook_adopt",
    {
      description: "Bring tally's rulebook template into this repository (operator session, on the operator's word: each rule it adds binds every session at once). It adds each template rule the repository never had and answers them; one adopted before, tailored or retired is not added again. A rule with `tailor` waits for this project's own answer: settle each with the operator through rule_tailor or context_retire.",
      inputSchema: { sessionId: z.string() },
    },
    ({ sessionId }) => inSession(source, sessionId, async (repo, session) => ok(await adoptRulebook(repo, session))),
  );
  server.registerTool(
    "rule_tailor",
    {
      description: "Write a rule's successor (operator session only): the rule as this project needs it, with `source`, whose word it is and when. What is left out stays as the old rule had it, so `source` alone keeps the rule as written and settles it. The old rule is retired and still read by its id.",
      inputSchema: {
        sessionId: z.string(),
        id: z.string().describe("the rule's id, for example rule-9"),
        source: limitedText(MAX_SOURCE, 1).describe(`whose word and when, or a decision's id, in one line, such as "the operator, 2026-11-14" or DEC-12`),
        title: limitedText(MAX_TITLE).optional().describe("the new title; the old one when left out"),
        text: limitedText(MAX_TEXT).optional().describe("the new text; the old one when left out"),
        section: z.enum(RULE_SECTIONS).optional().describe("the old rule's when left out, and needed when it had none"),
        paths: z.array(z.string()).max(MAX_LISTED).optional().describe("files, folders or globs from the repository's root; the old rule's when left out"),
        tags: z.array(z.string()).max(MAX_LISTED).optional().describe("words to find it by; the old rule's when left out"),
        refs: z.array(z.string()).max(MAX_LISTED).optional().describe("other records this one rests on; the old rule's when left out"),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await tailorRule(repo, session, defined(input)))),
  );
}
