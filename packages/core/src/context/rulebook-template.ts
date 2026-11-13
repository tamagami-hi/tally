export const RULE_SECTIONS = ["authority", "safety", "working", "once"] as const;

export type RuleSection = (typeof RULE_SECTIONS)[number];

export interface TemplateRule {
  key: string;
  section: RuleSection;
  title: string;
  text: string;
  tailor?: string;
}

export const RULEBOOK_SOURCE = "tally's rulebook template";

export const SECTION_HEADINGS: Readonly<Record<RuleSection, { heading: string; line: string }>> = {
  authority: { heading: "Authority", line: "What wins when two sources disagree." },
  safety: { heading: "Safety", line: "Breaking any of these fails the work, whatever the tests say." },
  working: { heading: "Working", line: "How the work is done." },
  once: { heading: "Doing each thing once", line: "How to reach correct work without doing anything twice." },
};

export const RULEBOOK: readonly TemplateRule[] = [
  {
    key: "authority-order",
    section: "authority",
    title: "When two sources disagree, the higher one wins",
    text: "Highest first: these rules; the decisions; the code as last verified, with the checks record and the build log; the commit bodies, which say why; the open questions and what each says to do meanwhile; the plans, which say what is intended, not built. A plan that differs from the code is corrected, unless the code breaks a rule or a decision; then the code is fixed.",
    tailor: "Is there a source outside this repository (a specification, another system's documents) that wins over this repository's summary of it? Name it and where it is.",
  },
  {
    key: "ship-only-when-asked",
    section: "safety",
    title: "Never push, release or deploy unasked",
    text: "Pushing, publishing, releasing and deploying are the operator's to do or to ask for. An agent builds and verifies on this machine, and never runs a command with raised privileges.",
    tailor: "How is this project released and deployed, and who runs it? Name the commands an agent never runs.",
  },
  {
    key: "secrets",
    section: "safety",
    title: "Credentials belong to the operator",
    text: "Never print a secret's value, never commit one, and never create, change or remove a credential or a .env file. Code reads a secret from its environment and, when it is missing, names it and stops.",
  },
  {
    key: "never-do",
    section: "safety",
    title: "Change nothing outside this repository that cannot be undone",
    text: "Until the operator names what this project must never do, these are forbidden: spending money, sending a message to a person, and any request that changes another system.",
    tailor: "What must this project never do, whatever the tests say (place an order, charge a card, send mail, write to a system it does not own)? Each is a rule of its own.",
  },
  {
    key: "not-ours",
    section: "safety",
    title: "What this project does not own is read-only",
    text: "Data, services, containers and files that belong to something else on this machine are never written, moved, restarted, pruned or deleted. Every command is scoped to this project's own names, never to everything on the machine.",
    tailor: "What shares this project's machine or feeds it data? Name what is read-only, and the names (project, containers, folders) that mark what is this project's own.",
  },
  {
    key: "invariants",
    section: "safety",
    title: "A result that breaks an invariant is wrong, whatever the tests say",
    text: "Until the operator names this project's invariants, a change that alters what a result means is the operator's to decide, never the builder's.",
    tailor: "What must always hold in this project's results (no look-ahead, no money created or lost, nothing sent twice)? Each is a rule of its own, with the test that enforces it.",
  },
  {
    key: "unknown",
    section: "safety",
    title: "Unknown stays unknown",
    text: "A value that is missing, unreadable or inconsistent is reported as missing and refused. It is never filled in, guessed or repaired silently, and every value shown traces back to where it came from.",
  },
  {
    key: "no-invented-values",
    section: "safety",
    title: "Do not invent a value a result depends on",
    text: "A price, a rate, a limit or a size that is not configured or verified gets no default. Show it as unconfigured and refuse the run that needs it, naming it. A number that must exist and is not verified is labelled unverified wherever it is printed.",
    tailor: "Which values must never be defaulted here?",
  },
  {
    key: "stored-formats",
    section: "safety",
    title: "Stored formats stay readable by the previous release",
    text: "A rollback swaps the code and keeps the data. So a schema, a file format or a stored record changes additively: add a field in one release, and drop one only in a later release.",
    tailor: "What does this project store for good, and which formats does this rule cover?",
  },
  {
    key: "operators-choices",
    section: "safety",
    title: "Open decisions and gates are the operator's, and only those",
    text: "A choice is the operator's when it changes what a result means or costs, what is stored for good, what the project may do, or an existing decision. It becomes a question that states the conservative behaviour to build meanwhile, and is never decided in code. Every other choice is the builder's: make it, record it in one line, and go on. Report a gate's evidence; never declare it closed.",
  },
  {
    key: "tests-first",
    section: "working",
    title: "Write the test first and see it fail on its assertion",
    text: "A failure to compile proves nothing. A test added for code that already exists is proven once, by breaking that code by hand and seeing the assertion fail. A fixture written from the code's own belief proves nothing. Never weaken a failing test: decide which side is wrong and say so in the commit.",
    tailor: "Where do the tests live, what coverage must hold, and which areas are tested whatever the coverage says?",
  },
  {
    key: "no-comments",
    section: "working",
    title: "No comments in source",
    text: "Name things so the code reads on its own, and put the why in the commit body. A script that guards a dangerous step is the exception: its gates carry their reasons.",
  },
  {
    key: "simple",
    section: "working",
    title: "Keep it simple",
    text: "No hardening against a threat that does not apply. No abstraction, switch or option until something concrete needs it.",
  },
  {
    key: "small-files",
    section: "working",
    title: "Source and test files stay under 400 lines, 800 at most",
    text: "A change that takes a file past 400 lines splits it in the same change. Lockfiles, generated files, fixtures, data and reports are exempt.",
  },
  {
    key: "no-silenced-warnings",
    section: "working",
    title: "No silenced warnings, and nothing without a reader",
    text: "The linter and the type checker run with warnings as errors, and the source silences none. A new field or option gets its reader in the same change; when the reader comes later, so does the field.",
  },
  {
    key: "one-commit-per-task",
    section: "working",
    title: "One commit per task, and main stays linear",
    text: "Each commit builds and passes the tests on its own. Sessions working at the same time each commit to their own track's branch in its own worktree, rebase it on main after every task and land it by fast-forward through tally. Main never holds a merge commit, and a track's branch is never pushed.",
  },
  {
    key: "commit-body",
    section: "working",
    title: "The commit body is the log",
    text: "The subject is type(scope): an imperative summary, under about 70 characters. The body says why, the tradeoffs, the earlier belief it corrects and the numbers it relies on, and never restates the diff. One identity, the repository's, and no line that names an agent or a tool.",
  },
  {
    key: "instance-or-class",
    section: "working",
    title: "When you fix a bug, ask whether it is an instance or a class",
    text: "Search the code around it for the same shape, fix what you find, and say in the commit what you searched.",
  },
  {
    key: "collect-questions",
    section: "working",
    title: "Collect questions; do not stop to ask them",
    text: "Add a question only for a choice that is the operator's. Take the conservative reading (the one that refuses, holds or reports unknown, never one that invents a value), write it as the question's meanwhile, build it, and keep going. Stop only for what only the operator can do: a credential, a push, a deploy, raised privileges.",
  },
  {
    key: "real-numbers",
    section: "working",
    title: "Report real numbers, measured once",
    text: "A count, a timing or a size is measured, not remembered, by whoever claims it, and written down with its command. A speed claim also names the machine and the data. Anyone else measures it again only when it looks wrong or a decision rests on it, never when its code has not changed.",
  },
  {
    key: "code-over-docs",
    section: "working",
    title: "Trust the code over the docs",
    text: "Check a document's claim against the source before building on it. When they differ, settle it by the order of authority and correct the one that lost, once.",
  },
  {
    key: "records-describe-the-code",
    section: "working",
    title: "The records describe the code by the end of each milestone",
    text: "A milestone is not done until the ledger, the checks record, the build log and the context entries its changes touch say what was built. Never leave a record that describes behaviour the code no longer has.",
  },
  {
    key: "scratch",
    section: "working",
    title: "Scratch stays under .temp/",
    text: "Everything an agent writes that is not part of the repository (plans, notes, logs, throwaway scripts and builds) goes under .temp/ in the checkout it works in, one folder per track. Nothing there is ever cited: what a record relies on is recorded through tally.",
  },
  {
    key: "decide-once",
    section: "once",
    title: "Decide once",
    text: "A choice recorded as a decision, in the build log, or settled by the order of authority is not reopened on opinion by a later step or agent. Evidence reopens it: a failing test or a measurement that shows a builder's choice wrong corrects it, and that is recorded; one that shows a decision wrong becomes a question.",
  },
  {
    key: "record-once",
    section: "once",
    title: "Record once",
    text: "Each fact has one home: a decision in the decisions, an open question in the questions, what was built and measured in the build log, the code as last verified in the checks record, progress in the ledger, and why in the commit body. Everything else points to that home and never copies it.",
  },
  {
    key: "read-once",
    section: "once",
    title: "Read once",
    text: "Read what the brief and the task name, not every document. Hand a helper these rules and the paths and ids it needs, never \"read everything\".",
  },
  {
    key: "check-once",
    section: "once",
    title: "Check once",
    text: "Before running a check, compare the code fingerprint with the checks record: while they match, the record is the verification, and nothing runs again. While working, run the checks of the part you changed, and the tests before each commit. The whole sweep runs once, before the milestone's last commit and before review.",
    tailor: "What is this project's whole sweep, command by command?",
  },
  {
    key: "review-once",
    section: "once",
    title: "Review once, against the plan",
    text: "A review checks, in this order: that every item the milestone was to deliver exists, by path and test name; the rules that tests cannot see, read against the diff; the sweep, once at HEAD; and the numbers a decision rests on. It blocks only on a missing item, a failing check, a broken rule, behaviour that differs from a decision or a plan, or a wrong number. A follow-up looks only at the fix commits.",
  },
  {
    key: "three-attempts",
    section: "once",
    title: "Three attempts, then move on",
    text: "When the same failure survives three different attempts, stop that path. Record what was tried and the error, add a question if only the operator can unblock it, and go on with the next task that does not depend on it. The stopped task stays open, and the milestone's report names it.",
  },
];
