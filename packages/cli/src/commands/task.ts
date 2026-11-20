import { Records, assertMilestoneOpen, commitRecords, other, plan, recordTask, removeTask, resolveOnMain, unwait, wait, type Repo } from "@tally/core";
import { list, need, parse, text } from "../args.ts";
import type { IO } from "../io.ts";
import { TallyError } from "@tally/core";

async function recorded(repo: Repo, io: IO, message: string): Promise<void> {
  io.out(message);
  const sha = await commitRecords(repo, message);
  if (sha !== null) io.out(`records: ${sha}`);
}

export async function taskCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  const records = new Records(repo);
  const resolve = resolveOnMain(repo.root, repo.config.mainBranch);
  switch (verb) {
    case "plan": {
      const parsed = parse(rest, { track: { type: "string" } });
      const track = text(parsed, "track");
      if (track === undefined) throw new TallyError("plan needs --track", 2);
      const [milestone, ...tasks] = parsed.positionals;
      if (milestone === undefined || tasks.length === 0) throw new TallyError("plan needs a milestone and at least one task", 2);
      await assertMilestoneOpen(repo, await records.readLedger(), milestone);
      await recorded(repo, io, await records.update((ledger) => plan(ledger, { milestone, track, tasks })));
      return 0;
    }
    case "land": {
      const parsed = parse(rest, { track: { type: "string" }, also: { type: "string", multiple: true }, checked: { type: "string" } });
      const checked = text(parsed, "checked");
      if (checked !== undefined && checked !== "tip") throw new TallyError(`--checked takes tip, the mark of a landing that checked its tip only, not '${checked}'`, 2);
      const input = { milestone: need(parsed, 0, "milestone"), task: need(parsed, 1, "task"), commit: need(parsed, 2, "commit"), also: list(parsed, "also"), ...(checked === undefined ? {} : { checked: "tip" as const }) };
      const track = text(parsed, "track");
      const { message, problem } = await recordTask(repo, track === undefined ? input : { ...input, track });
      if (problem !== undefined) io.err(problem);
      await recorded(repo, io, message);
      return 0;
    }
    case "wait": {
      const parsed = parse(rest, {});
      const input = { milestone: need(parsed, 0, "milestone"), task: need(parsed, 1, "task"), what: need(parsed, 2, "what it waits for") };
      await recorded(repo, io, await records.update((ledger) => wait(ledger, input)));
      return 0;
    }
    case "unwait": {
      const parsed = parse(rest, {});
      const input = { milestone: need(parsed, 0, "milestone"), task: need(parsed, 1, "task") };
      await recorded(repo, io, await records.update((ledger) => unwait(ledger, input)));
      return 0;
    }
    case "remove": {
      const parsed = parse(rest, { why: { type: "string" } });
      const why = text(parsed, "why");
      if (why === undefined) throw new TallyError("tally task remove <milestone> <task> --why REASON: say why the task is removed", 2);
      const { message, problem } = await removeTask(repo, { milestone: need(parsed, 0, "milestone"), task: need(parsed, 1, "task"), why });
      if (problem !== undefined) io.err(problem);
      await recorded(repo, io, message);
      return 0;
    }
    case "other": {
      const parsed = parse(rest, {});
      const input = { commit: need(parsed, 0, "commit"), note: need(parsed, 1, "note") };
      await recorded(repo, io, await records.update((ledger) => other(ledger, input, resolve)));
      return 0;
    }
    default:
      throw new TallyError(`tally task: unknown verb '${verb ?? ""}'; use plan, land, wait, unwait or other`, 2);
  }
}
