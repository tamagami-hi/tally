import { basename } from "node:path";

export const REPO_NAME = /^[a-z0-9][a-z0-9_-]*$/;

const FALLBACK = "repo";

export function nameFromFolder(root: string): string {
  const name = basename(root)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return name === "" ? FALLBACK : name;
}
