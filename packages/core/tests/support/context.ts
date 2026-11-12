import type { Repo } from "../../src/store/records.ts";

export const DATA = { track: "data", agent: "claude" };
export const ENGINE = { track: "engine", agent: "kiro" };
export const OPERATOR = { track: "main", agent: "operator" };

export const keepingContextAsRecords = (repo: Repo): Repo => ({ ...repo, config: { ...repo.config, context: "records" } });
