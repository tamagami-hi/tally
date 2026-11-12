import { z } from "zod";
import { TallyError } from "../errors.ts";

const totalsSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

export const verifiedSchema = z.object({ what: z.string().min(1), check: z.string().min(1), totals: totalsSchema.optional() });

export const buildlogFields = {
  built: z.string().min(1).optional(),
  verified: z.array(verifiedSchema).optional(),
  decided: z.array(z.string().min(1)).optional(),
  corrected: z.array(z.string().min(1)).optional(),
  open: z.array(z.string().min(1)).optional(),
};

export type Totals = z.infer<typeof totalsSchema>;
export type Verified = z.infer<typeof verifiedSchema>;

export interface BuildlogFields {
  built?: string | undefined;
  verified?: Verified[] | undefined;
  decided?: string[] | undefined;
  corrected?: string[] | undefined;
  open?: string[] | undefined;
}

export interface VerifiedInput {
  what: string;
  check: string;
  totals?: Totals | undefined;
}

export interface FieldsInput {
  built?: string;
  verified?: readonly VerifiedInput[];
  decided?: readonly string[];
  corrected?: readonly string[];
  open?: readonly string[];
}

export const FIELD_NAMES = ["built", "verified", "decided", "corrected", "open"] as const;

const LISTS = [["decided", "Decided"], ["corrected", "Corrected"], ["open", "Open"]] as const;

const said = (lines: readonly string[] | undefined): string[] => (lines ?? []).map((line) => line.trim()).filter((line) => line !== "");

function verifiedItem(item: VerifiedInput): Verified {
  const what = item.what.trim();
  const check = item.check.trim();
  if (what === "" || check === "") throw new TallyError("a verified item needs what was verified and the check that showed it");
  return { what, check, ...(item.totals === undefined ? {} : { totals: item.totals }) };
}

export function fieldsOf(input: FieldsInput): BuildlogFields {
  const built = (input.built ?? "").trim();
  const verified = (input.verified ?? []).map(verifiedItem);
  const lists = LISTS.map(([key]) => [key, said(input[key])] as const).filter(([, lines]) => lines.length > 0);
  return { ...(built === "" ? {} : { built }), ...(verified.length === 0 ? {} : { verified }), ...Object.fromEntries(lists) };
}

const totalsText = (totals: Totals | undefined): string => (totals === undefined || Object.keys(totals).length === 0 ? "" : ` (${Object.entries(totals).map(([name, value]) => `${name} ${value}`).join(", ")})`);

const listed = (label: string, lines: readonly string[] | undefined): string[] => (lines === undefined || lines.length === 0 ? [] : [`**${label}:**\n${lines.map((line) => `- ${line}`).join("\n")}`]);

export function fieldBlocks(entry: BuildlogFields): string[] {
  return [
    ...(entry.built === undefined ? [] : [`**Built:** ${entry.built}`]),
    ...listed("Verified", entry.verified?.map((item) => `${item.what}: \`${item.check}\`${totalsText(item.totals)}`)),
    ...LISTS.flatMap(([key, label]) => listed(label, entry[key])),
  ];
}
