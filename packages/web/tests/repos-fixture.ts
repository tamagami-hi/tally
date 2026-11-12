import type { RepoIndex } from "../src/types.ts";

export const index: RepoIndex = {
  workspace: "/work",
  repos: [
    { name: "alpha", root: "/work/alpha", project: "Alpha", isDefault: true, sessions: 2, locks: 0, questions: 1, problems: 0, overall: 0.5 },
    { name: "beta", root: "/work/beta", project: "Beta", isDefault: false, sessions: 0, locks: 0, questions: 0, problems: 3, overall: 0.25, problem: "its config.json is not valid JSON" },
  ],
};
