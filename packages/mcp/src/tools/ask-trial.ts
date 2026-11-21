import { randomBytes } from "node:crypto";
import { CLIENT_CAPABILITIES_META_KEY, acceptedContent, createRequestStateCodec, inputRequired, inputResponse, type RequestStateCodec, type ServerContext } from "@modelcontextprotocol/server";
import { TallyError } from "@tally/core";
import { z } from "zod";
import type { Decorated } from "../decorate.ts";
import type { ToolMeta } from "../meta.ts";
import { ok, refused } from "../respond.ts";

export const ASK_TRIAL = "ask_trial";
export const ASK_META: ToolMeta = { title: "Ask the person, as a trial", effect: "read" };

const KEY_BYTES = 32;
const MOST_ABOUT = 500;
const MOST_WAIT_SECONDS = 3600;
const QUESTION = "confirm";

export const NOBODY_AT_HAND = "a client with nobody at hand answers cancel at once, so a cancel can mean that nobody saw the question";
export const CANNOT_CARRY = "this connection cannot carry a question: a 2025-era request at this stateless address cannot be asked anything; a client on 2026-07-28 can";
export const NO_FORM = "this client declares no form elicitation, so it cannot be asked";
export const UNSEALED = "this answer came back with a question this tally did not seal, sealed before it restarted or more than an hour ago; call ask_trial again";
export const NO_ANSWER = "this call came back with no answer to the question; call ask_trial again";
export const NOT_FILLED = "the form came back without a yes or no and the person's words; call ask_trial again";

export interface Sealed {
  about: string;
  askedAt: number;
}

export interface Asking {
  carries: boolean;
  codec?: RequestStateCodec<Sealed>;
  now?: () => number;
}

const PROCESS_CODEC = createRequestStateCodec<Sealed>({ key: randomBytes(KEY_BYTES), ttlSeconds: MOST_WAIT_SECONDS });

const FORM = z.object({
  confirm: z.boolean().describe("Yes or no"),
  said: z.string().min(1).describe("Your answer, in your own words"),
});

const DESCRIPTION = "A trial that writes nothing and decides nothing: it asks the person, through your client's own dialog, the question in about, with a yes or no and their own words, and answers what happened: asked, the action (accept, decline or cancel), confirmed and said, and how long the person took. asked: false says why this connection cannot ask.";

function declaresForm(context: ServerContext): boolean {
  const envelope = context.mcpReq.envelope as Readonly<Record<string, unknown>> | undefined;
  const declared = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: { form?: unknown; url?: unknown } } | undefined;
  const elicitation = declared?.elicitation;
  return elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined);
}

async function opening(about: string, context: ServerContext, asking: Required<Asking>) {
  if (!asking.carries) return ok({ asked: false, reason: CANNOT_CARRY });
  if (!declaresForm(context)) return ok({ asked: false, reason: NO_FORM });
  const requestState = await asking.codec.mint({ about, askedAt: asking.now() });
  return inputRequired({ inputRequests: { [QUESTION]: inputRequired.elicit({ message: about, requestedSchema: FORM }) }, requestState });
}

async function finishing(state: unknown, context: ServerContext, asking: Required<Asking>) {
  const sealed = await asking.codec.verify(String(state), context).catch(() => undefined);
  if (sealed === undefined) return refused(new TallyError(UNSEALED));
  const waitedMs = asking.now() - sealed.askedAt;
  const view = inputResponse(context.mcpReq.inputResponses, QUESTION);
  if (view.kind !== "elicit") return refused(new TallyError(NO_ANSWER));
  if (view.action !== "accept") return ok({ asked: true, action: view.action, about: sealed.about, waitedMs, note: NOBODY_AT_HAND });
  const filled = acceptedContent(context.mcpReq.inputResponses, QUESTION, FORM);
  if (filled === undefined) return refused(new TallyError(NOT_FILLED));
  return ok({ asked: true, action: "accept", about: sealed.about, confirmed: filled.confirm, said: filled.said, waitedMs });
}

export function registerAskTrial(tools: Decorated, given: Asking): void {
  const asking: Required<Asking> = { codec: PROCESS_CODEC, now: Date.now, ...given };
  tools.registerTool(ASK_TRIAL, { description: DESCRIPTION, inputSchema: { about: z.string().min(1).max(MOST_ABOUT).describe("The question to put to the person, in a sentence") } }, async (args: { about: string }, extra: unknown) => {
    const context = extra as ServerContext;
    const state = context.mcpReq.requestState();
    return state === undefined ? opening(args.about, context, asking) : finishing(state, context, asking);
  });
}
