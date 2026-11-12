import { execFile } from "node:child_process";
import { TallyError } from "../errors.ts";
import { gitOut } from "../git/run.ts";

const NAMED = /filter=([A-Za-z0-9_.-]+)/g;
const ACTIONS = ["clean", "smudge", "process"] as const;

function available(program: string): Promise<boolean> {
  return new Promise((done) => {
    execFile("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", program], (error) => done(error === null));
  });
}

async function namedFilters(root: string): Promise<string[]> {
  const found = await gitOut(root, ["grep", "-h", "-I", "-o", "-E", "filter=[A-Za-z0-9_.-]+", "HEAD", "--", ".gitattributes", "**/.gitattributes"]);
  if (found === null) return [];
  return [...new Set([...found.matchAll(NAMED)].map((match) => match[1] ?? ""))].filter((name) => name !== "");
}

export async function checkFilters(root: string): Promise<void> {
  for (const name of await namedFilters(root)) {
    for (const action of ACTIONS) {
      const command = await gitOut(root, ["config", "--get", `filter.${name}.${action}`]);
      const program = command?.trim().split(/\s+/)[0];
      if (program === undefined || program === "") continue;
      if (!(await available(program))) {
        throw new TallyError(`${root} uses the git filter '${name}', whose program ${program} is not available here; install it, or the files it filters would be committed wrongly`);
      }
    }
  }
}
