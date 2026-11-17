import { z } from "zod";
import { MOST_OWNER, MOST_PARKED_WHY } from "@tally/core";
import { limitedText } from "./limited.ts";

const why = limitedText(MOST_PARKED_WHY, 1);
const owner = limitedText(MOST_OWNER, 1);

export const parkedInput = z.strictObject({
  why: why.describe("why it is left on purpose, in a line"),
  decision: z.string().min(1).optional().describe("the decision that covers it, such as DEC-12"),
  owner: owner.optional().describe("who will pick it up"),
});

export const deferredInput = z.strictObject({
  what: z.string().min(1),
  to: z.string().min(1).optional(),
  parked: z.strictObject({ why, decision: z.string().min(1).optional(), owner: owner.optional() }).optional(),
});
