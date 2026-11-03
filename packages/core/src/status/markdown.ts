import type { StatusData } from "./collect.ts";

const percent = (share: number): string => `${Math.round(share * 100)}%`;

export function renderMarkdown(s: StatusData): string {
  const out = [`# ${s.name} status, ${s.time}`, ""];
  out.push(`**Overall ~${percent(s.overall)}**: ${s.stages.map((st) => `Stage ${st.id} ${percent(s.stagePct[st.id] ?? 0)}`).join(", ")}`);
  out.push(`main \`${s.main}\`; origin \`${s.origin ?? "none"}\`, ${s.unpushed} unpushed; ${s.today} commits today`);
  out.push("", "| Stage | Milestone | Track | Where it stands | Done |", "|---|---|---|---|---|");
  let last: string | undefined;
  s.rows.forEach((r, i) => {
    const stage = r.stage !== last ? `**${r.stage}**` : "";
    last = r.stage;
    const stands = [...(r.count === null ? [] : [`${r.count[0]}/${r.count[1]} in`]), ...r.notes].join("; ");
    out.push(`| ${stage} | ${r.id} ${r.name} | ${r.track} | ${stands} | ${percent(r.share)} |`);
    const next = s.rows[i + 1];
    if (next === undefined || next.stage !== r.stage) {
      out.push(`| | **Stage ${r.stage} total** | | | **${percent(s.stagePct[r.stage] ?? 0)}** |`);
    }
  });
  out.push("", "| Track | HEAD | Last commit | vs main | Worktree |", "|---|---|---|---|---|");
  for (const t of s.tracks) {
    const tree = t.dirty > 0 ? `${t.dirty} files uncommitted` : "clean";
    out.push(`| ${t.track} | \`${t.head}\` ${t.subject.slice(0, 50)} | ${t.when} | +${t.ahead} / -${t.behind} | ${tree} |`);
  }
  out.push("", `Open questions: ${s.questions.length > 0 ? s.questions.join(", ") : "none"}; next row ${s.nextRow ?? "unknown"}`);
  if (s.problems.length > 0) out.push("", "**Ledger needs attention:**", ...s.problems.map((p) => `- ${p}`));
  return out.join("\n");
}
