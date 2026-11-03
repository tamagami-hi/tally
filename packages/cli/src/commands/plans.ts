import { TallyError, readPlans, type Repo } from "@tally/core";
import type { IO } from "../io.ts";

export async function plansCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb] = argv;
  if (verb !== "list") throw new TallyError(`tally plans: unknown verb '${verb ?? ""}'; use list (tally import plans scans them)`, 2);
  const { plans } = await readPlans(repo);
  if (plans.length === 0) {
    io.out("no plans recorded yet; run tally import plans");
    return 0;
  }
  for (const plan of plans) io.out(`${plan.status.padEnd(9)} ${plan.group.padEnd(12)} ${plan.path}  ${plan.title}`);
  return 0;
}
