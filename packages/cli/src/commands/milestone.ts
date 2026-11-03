import { Records, TallyError, addMilestone, commitRecords, type Repo } from "@tally/core";
import { need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function milestoneCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb !== "add") throw new TallyError(`tally milestone: unknown verb '${verb ?? ""}'; use add`, 2);
  const parsed = parse(rest, {
    stage: { type: "string" },
    name: { type: "string" },
    track: { type: "string" },
    weight: { type: "string" },
    waits: { type: "string" },
    group: { type: "string" },
  });
  const id = need(parsed, 0, "milestone id");
  const stage = text(parsed, "stage");
  const name = text(parsed, "name");
  const track = text(parsed, "track");
  const weight = text(parsed, "weight");
  if (stage === undefined || name === undefined || track === undefined || weight === undefined) {
    throw new TallyError("milestone add needs --stage, --name, --track and --weight", 2);
  }
  const waits = text(parsed, "waits");
  const group = text(parsed, "group");
  const input = {
    id,
    stage,
    name,
    track,
    weight: Number(weight),
    ...(waits === undefined ? {} : { waits }),
    ...(group === undefined ? {} : { group }),
  };
  const stages = repo.config.stages.map((s) => s.id);
  const message = await new Records(repo).update((ledger) => addMilestone(ledger, input, stages));
  io.out(message);
  const sha = await commitRecords(repo, message);
  if (sha !== null) io.out(`records: ${sha}`);
  return 0;
}
