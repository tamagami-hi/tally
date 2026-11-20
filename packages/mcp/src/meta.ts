import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { CommandPlace } from "@tally/core";

type Effect = "read" | "wait" | "add" | "replace" | "remove";

export interface ToolMeta {
  title: string;
  effect: Effect;
  again?: true;
  outside?: true;
  newestFirst?: true;
  whole?: readonly string[];
  since?: string;
}

const read = (title: string): ToolMeta => ({ title, effect: "read" });
const add = (title: string): ToolMeta => ({ title, effect: "add" });
const addAgain = (title: string): ToolMeta => ({ title, effect: "add", again: true });
const replace = (title: string): ToolMeta => ({ title, effect: "replace", again: true });
const runs = (title: string): ToolMeta => ({ title, effect: "add", outside: true });

export const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  session_open: { title: "Open a session", effect: "add", newestFirst: true, whole: ["brief.rules", "brief.cited"] },
  session_close: add("Close a session"),
  session_list: read("List open sessions"),
  repo_list: read("List repositories"),
  board_get: read("Read the board"),
  ledger_check: read("Check the ledger"),
  milestone_add: add("Add a milestone"),
  milestone_deliver: add("Add deliverables to a milestone"),
  milestone_edit: { ...add("Edit a milestone"), since: "0.7.0" },
  milestone_remove: { title: "Remove a milestone", effect: "remove", since: "0.7.0" },
  task_plan: add("Plan tasks"),
  task_claim: add("Claim a task"),
  task_release: add("Give a claimed task back"),
  task_wait: addAgain("Mark a task as waiting"),
  task_unwait: addAgain("Clear a task's wait"),
  task_remove: { title: "Remove a planned task", effect: "remove" },
  task_land: add("Record a landed task"),
  task_other: add("Record a commit that is no task's"),
  land_run: runs("Land a track, running its tests here"),
  land_start: add("Join the landing queue"),
  land_wait: { title: "Wait for a landing ticket", effect: "wait" },
  land_cancel: add("Leave the landing queue"),
  evidence_run: { title: "Run a command and record it", effect: "remove", outside: true },
  evidence_record: add("Record a run that already happened"),
  evidence_list: read("List run records"),
  handoff_read: read("Read a track's hand-off"),
  handoff_write: replace("Write the track's hand-off"),
  lock_acquire: add("Hold a named lock"),
  lock_release: add("Release a named lock"),
  lock_list: read("List held locks"),
  docs_list: read("List documents"),
  docs_read: read("Read a document"),
  docs_search: read("Search the documents"),
  question_add: add("Ask the operator a question"),
  question_list: read("List questions"),
  question_edit: { ...add("Edit a question"), since: "0.3.0" },
  decision_list: read("List decisions"),
  decision_record: { ...add("Record a decision on the operator's word"), since: "0.8.0" },
  decision_status: { ...replace("Set a decision's status"), since: "0.8.0" },
  question_answer: { ...add("Answer a question with a decision"), since: "0.8.0" },
  covering: { ...read("List what covers some files"), since: "0.8.0" },
  context_pack: read("Read a context pack"),
  views_claude: replace("Show or write CLAUDE.md's standing block"),
  checks_get: read("Read the code-check record"),
  checks_set: replace("Replace the code-check record"),
  checks_fingerprint: read("Compare the code checks with main"),
  buildlog_append: add("Add a build-log section"),
  buildlog_render: read("Render a build log"),
  note_post: add("Leave a note for other tracks"),
  note_reply: add("Reply to a note"),
  note_done: addAgain("Mark a note done"),
  note_list: read("List notes"),
  inbox_get: read("Read the inbox again"),
  track_open: add("Open a track"),
  track_close: { title: "Close a track", effect: "remove" },
  track_list: read("List tracks"),
  track_edit: { ...add("Widen a track"), since: "0.7.0" },
  context_get: { title: "Read context entries", effect: "read", newestFirst: true },
  context_put: add("Add a context entry"),
  context_retire: add("Retire a context entry"),
  project_set: replace("Set the project record"),
  repo_configure: replace("Change the repository's config"),
  activity_get: read("Read the activity log"),
  rulebook_get: { title: "Read the rulebook", effect: "read", newestFirst: true, since: "0.2.0" },
  rulebook_adopt: { ...addAgain("Bring the rulebook template"), since: "0.2.0" },
  rule_tailor: { ...add("Tailor a rule"), since: "0.2.0" },
  phase_add: { ...add("Add a phase"), since: "0.2.0" },
  phase_list: { ...read("List phases"), since: "0.2.0" },
  phase_close: { title: "Close a phase", effect: "remove", since: "0.2.0" },
  cycle_list: { ...read("List cycles"), since: "0.7.0" },
  cycle_close: { title: "Close the current cycle", effect: "remove", since: "0.7.0" },
  records_commit: { ...addAgain("Commit the waiting records"), since: "0.2.0" },
  deferred_list: { ...read("List deferred parts"), since: "0.3.0" },
  deferred_set: { ...replace("Place a deferred part"), since: "0.3.0" },
  review_record: { ...add("Record a review"), since: "0.3.0" },
  review_list: { title: "List reviews", effect: "read", newestFirst: true, since: "0.3.0" },
};

const AGENT_META: Readonly<Record<string, ToolMeta>> = {
  evidence_run: read("Give the line that runs and records a command"),
};

const SERVICE_ONLY: ReadonlySet<string> = new Set(["land_run"]);

export const isListed = (tool: string, place: CommandPlace): boolean => place !== "agent" || !SERVICE_ONLY.has(tool);

export const listedTools = (place: CommandPlace): string[] => Object.keys(TOOL_META).filter((tool) => isListed(tool, place));

export const metaOf = (tool: string, place: CommandPlace): ToolMeta | undefined => (place === "agent" ? (AGENT_META[tool] ?? TOOL_META[tool]) : TOOL_META[tool]);

export function annotationsOf(meta: ToolMeta): ToolAnnotations {
  const reads = meta.effect === "read";
  return {
    readOnlyHint: reads,
    destructiveHint: meta.effect === "replace" || meta.effect === "remove",
    idempotentHint: reads || meta.effect === "wait" || meta.again === true,
    openWorldHint: meta.outside === true,
  };
}

const NEWEST_VERSIONS = 2;

const versionKey = (version: string): number[] => version.split(".").map(Number);

const compareVersions = (a: string, b: string): number => {
  const [left, right] = [versionKey(a), versionKey(b)];
  const at = left.findIndex((part, index) => part !== right[index]);
  return at === -1 ? 0 : (left[at] ?? 0) - (right[at] ?? 0);
};

export function newestTools(place: CommandPlace = "service"): string[] {
  const versions = [...new Set(Object.values(TOOL_META).flatMap((meta) => (meta.since === undefined ? [] : [meta.since])))].sort(compareVersions).slice(-NEWEST_VERSIONS);
  return Object.entries(TOOL_META).filter(([name, meta]) => meta.since !== undefined && versions.includes(meta.since) && isListed(name, place)).map(([name]) => name);
}

export const newestFirst = (tool: string): boolean => TOOL_META[tool]?.newestFirst === true;

export const wholePaths = (tool: string): readonly string[] => TOOL_META[tool]?.whole ?? [];

export const writesNothing = (tool: string, place: CommandPlace = "service"): boolean => {
  const effect = metaOf(tool, place)?.effect;
  return effect === "read" || effect === "wait";
};
