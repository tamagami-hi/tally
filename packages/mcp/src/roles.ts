export const SERVER_NAME = "tally";

export const ROLES = ["builder", "reviewer"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_TOOLS: Readonly<Record<Role, readonly string[]>> = {
  builder: ["session_open", "session_close", "task_claim", "task_release", "task_wait", "task_unwait", "evidence_record", "evidence_list", "land_start", "land_wait", "land_cancel", "handoff_read", "handoff_write", "note_post", "note_reply", "note_done", "inbox_get", "question_add", "question_list", "decision_list", "context_get", "context_put", "covering", "board_get"],
  reviewer: ["session_open", "session_close", "review_record", "review_list", "evidence_list", "decision_list", "context_get", "context_put", "covering", "rulebook_get", "question_add", "handoff_read", "note_post", "inbox_get", "board_get"],
};

export const ROLE_PROTOCOL: Readonly<Record<Role, string>> = {
  builder: [
    "You build one track's tasks, in this order.",
    "1. session_open with the folder you work in. Its brief is your work order: the tasks, what done looks like (accept), and the records they cite, word for word. A record is the authority over any brief that restates it.",
    "2. task_claim a task before you change a file for it.",
    "3. Build to its accept lines and its cited records. covering answers what else covers a file. Where the brief and a record differ, say so before building: note_post to the main track, kind request, with record set to the record's id.",
    "4. Run each check with the runner line session_open gave, so the run is recorded; evidence_record records a run already made.",
    "5. land_start, then land_wait. task_wait marks a task that waits on another.",
    "6. handoff_write what the next session needs, then session_close.",
    "A choice that is the operator's goes to question_add. Never push, release or deploy.",
  ].join("\n"),
  reviewer: [
    "You review work against its records, in this order. You change no code.",
    "1. session_open with the folder you work in.",
    "2. covering with the range under review answers the decisions and context entries that apply to its files; with task, the records that task cites.",
    "3. evidence_list for the runs recorded, review_list for earlier reviews, handoff_read for what the track said.",
    "4. review_record your verdict, with your own text.",
    "5. A brief that differs from a record is reported with note_post, kind request, with record set to the record's id; a finding worth keeping goes in with context_put.",
    "6. session_close.",
    "A choice that is the operator's goes to question_add.",
  ].join("\n"),
};

const ROLE_LINE: Readonly<Record<Role, string>> = {
  builder: "Builds one track's tasks from tally's work order.",
  reviewer: "Reviews work against tally's records, changing no code.",
};

export interface RoleDefinition {
  address: string;
  tools: string[];
  allowedTools: string[];
}

export interface RoleAnswer extends RoleDefinition {
  role: Role;
  protocol: string;
  agentFile: string;
}

export const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

export const isInRole = (role: Role | undefined, tool: string): boolean => role === undefined || ROLE_TOOLS[role].includes(tool);

const allowedTools = (role: Role): string[] => ROLE_TOOLS[role].map((tool) => `mcp__${SERVER_NAME}__${tool}`);

export const roleOf = (role: Role, prefix = ""): RoleDefinition => ({ address: `${prefix}/mcp/${role}`, tools: [...ROLE_TOOLS[role]], allowedTools: allowedTools(role) });

export const rolesOf = (prefix = ""): Record<Role, RoleDefinition> => ({ builder: roleOf("builder", prefix), reviewer: roleOf("reviewer", prefix) });

const agentFileOf = (role: Role): string => `---\nname: tally-${role}\ndescription: ${ROLE_LINE[role]}\ntools: ${allowedTools(role).join(", ")}\n---\n\n${ROLE_PROTOCOL[role]}\n`;

export const roleAnswer = (role: Role, prefix = ""): RoleAnswer => ({ role, ...roleOf(role, prefix), protocol: ROLE_PROTOCOL[role], agentFile: agentFileOf(role) });
