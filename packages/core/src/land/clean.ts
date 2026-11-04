import { TallyError, messageOf } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Landing } from "../schema/config.ts";
import { moveLandingCheckout, openLandingCheckout } from "./checkout.ts";
import type { RunTests } from "./run-tests.ts";

const SHORT_HASH = 7;

export interface CommitTests {
  tree: string;
  track: string;
  range: string;
  command: readonly string[];
  env: NodeJS.ProcessEnv;
  landing: Landing;
  runTests: RunTests;
  log: (line: string) => void;
}

function landingValues({ env = {} }: Landing, tree: string, track: string): Record<string, string> {
  const filled = (value: string): string => value.replaceAll("{worktree}", () => tree).replaceAll("{track}", () => track);
  return Object.fromEntries(Object.entries(env).map(([name, value]) => [name, filled(value)]));
}

export async function testCommits({ tree, track, range, command, env, landing, runTests, log }: CommitTests): Promise<void> {
  const commits = (await gitMust(tree, ["rev-list", "--reverse", range])).split("\n").filter((line) => line !== "");
  if (commits.length === 0) return;
  const checkout = await openLandingCheckout(tree, track);
  const testEnv = { ...env, ...landingValues(landing, tree, track) };
  for (const [index, commit] of commits.entries()) {
    const label = await gitMust(tree, ["log", "-1", "--format=%h %s", `--abbrev=${SHORT_HASH}`, commit]);
    await moveLandingCheckout(checkout, commit, tree, landing.link ?? []);
    log(`testing ${label} (${index + 1} of ${commits.length})`);
    try {
      await runTests(checkout, command, testEnv, label);
    } catch (error: unknown) {
      throw new TallyError(`${label} failed: ${messageOf(error)}`);
    }
  }
}

export async function undoCommit(tree: string, parent: string, commit: string): Promise<string> {
  const short = commit.slice(0, SHORT_HASH);
  try {
    if ((await gitMust(tree, ["rev-parse", "HEAD"])) !== commit) return `the branch moved on, so ${short} stays on it`;
    await gitMust(tree, ["reset", "--soft", parent]);
    return `${short} is undone, and its files stay staged`;
  } catch (error: unknown) {
    return `${short} could not be undone, so it stays on the branch: ${messageOf(error)}`;
  }
}
