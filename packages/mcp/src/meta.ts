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
}

const read = (title: string): ToolMeta => ({ title, effect: "read" });
const add = (title: string): ToolMeta => ({ title, effect: "add" });
const addAgain = (title: string): ToolMeta => ({ title, effect: "add", again: true });
const replace = (title: string): ToolMeta => ({ title, effect: "replace", again: true });
const runs = (title: string): ToolMeta => ({ title, effect: "add", outside: true });

export const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  session_open: { title: "Open a session", effect: "add", newestFirst: true, whole: ["brief.rules"] },
  session_close: add("Close a session"),
  session_list: read("List open sessions"),
  repo_list: read("List repositories"),
  board_get: read("Read the board"),
  ledger_check: read("Check the ledger"),
  milestone_add: add("Add a milestone"),
  milestone_deliver: add("Add deliverables to a milestone"),
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
  question_edit: add("Edit a question"),
  decision_list: read("List decisions"),
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
  context_get: { title: "Read context entries", effect: "read", newestFirst: true },
  context_put: add("Add a context entry"),
  context_retire: add("Retire a context entry"),
  project_set: replace("Set the project record"),
  repo_configure: replace("Change the repository's config"),
  activity_get: read("Read the activity log"),
  rulebook_get: { title: "Read the rulebook", effect: "read", newestFirst: true },
  rulebook_adopt: addAgain("Bring the rulebook template"),
  rule_tailor: add("Tailor a rule"),
  phase_add: add("Add a phase"),
  phase_list: read("List phases"),
  phase_close: { title: "Close a phase", effect: "remove" },
  records_commit: addAgain("Commit the waiting records"),
  deferred_list: read("List deferred parts"),
  deferred_set: replace("Place a deferred part"),
  review_record: add("Record a review"),
  review_list: { title: "List reviews", effect: "read", newestFirst: true },
};

const AGENT_META: Readonly<Record<string, ToolMeta>> = {
  evidence_run: read("Give the line that runs and records a command"),
};

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

export const newestFirst = (tool: string): boolean => TOOL_META[tool]?.newestFirst === true;

export const wholePaths = (tool: string): readonly string[] => TOOL_META[tool]?.whole ?? [];

export const writesNothing = (tool: string, place: CommandPlace = "service"): boolean => {
  const effect = metaOf(tool, place)?.effect;
  return effect === "read" || effect === "wait";
};
