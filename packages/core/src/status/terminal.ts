import type { StatusData } from "./collect.ts";
import { BOLD, CYAN, DIM, GREEN, Paint, RED, Raw, YELLOW, bar, clip, fit, pct, pctColour, table, wrap, type Row } from "./table.ts";

export function renderTerminal(s: StatusData, paint: Paint, columns: number): string {
  const p = (text: string, ...codes: string[]): string => paint.call(text, ...codes);
  const width = Math.max(95, Math.min(columns, 150));
  const out = [p(` ${s.name} build status · ${s.time} `, BOLD, CYAN), ""];
  out.push(`  ${p("Overall", BOLD)}   ${bar(s.overall, 32, paint)} ${p(pct(s.overall), BOLD, pctColour(s.overall))}`);
  for (const stage of s.stages) {
    const share = s.stagePct[stage.id] ?? 0;
    out.push(`  Stage ${stage.id}   ${bar(share, 32, paint)} ${p(pct(share), pctColour(share))}${p(`   ${stage.name}`, DIM)}`);
  }
  out.push("");
  const pushed = s.unpushed > 0 ? p(`${s.unpushed} commits unpushed`, YELLOW) : p("all pushed", GREEN);
  out.push(`  main    ${p(s.main.slice(0, 7), CYAN)}  ${clip(s.main.slice(8), width - 20)}`);
  out.push(`  origin  ${p(s.origin ?? "none", CYAN)}  ${pushed} · ${s.today} commits today`);
  out.push("");

  const widths = fit([5, width >= 110 ? 24 : 22, 14, 0, 16], 3, width, 22);
  const rows: Row[] = [];
  let last: string | undefined;
  for (const r of s.rows) {
    const first = r.stage !== last;
    if (last !== undefined && first) rows.push("---");
    last = r.stage;
    const stands = r.count === null ? r.notes.join("\n") : `${r.count[0]} of ${r.count[1]} tasks in\n${r.notes.map((n) => `· ${n}`).join("\n")}`;
    const active = r.share > 0 && r.share < 1;
    const done = `${bar(r.share, 10, paint)} ${p(pct(r.share), pctColour(r.share))}`;
    rows.push([
      [first ? r.stage : "", [BOLD]],
      [`${r.id}  ${r.name}`, active ? [BOLD] : []],
      r.track,
      [stands, active ? [] : [DIM]],
      new Raw(done, 15),
    ]);
  }
  out.push(table(["Stage", "Milestone", "Track", "Where it stands", "Done"], rows, widths, paint));
  out.push("");

  const tw = fit([8, 8, 0, 14, 9, 14], 2, width, 22);
  const trows: Row[] = s.tracks.map((t) => [
    [t.track, [BOLD]],
    [t.head, [CYAN]],
    clip(t.subject, tw[2] ?? 22),
    t.when,
    `+${t.ahead} / -${t.behind}`,
    t.dirty > 0 ? [`${t.dirty} files open`, [YELLOW]] : ["clean", [GREEN]],
  ]);
  out.push(table(["Track", "HEAD", "Last commit", "When", "vs main", "Worktree"], trows, tw, paint));
  out.push("");

  const questions = s.questions.length > 0 ? s.questions.join(", ") : p("none", GREEN);
  out.push(`  Open questions: ${questions} · next row ${s.nextRow ?? "unknown"}`);
  if (s.problems.length > 0) {
    out.push("", `  ${p("Ledger needs attention:", BOLD, RED)}`);
    for (const problem of s.problems) {
      wrap(problem, width - 6).forEach((line, i) => out.push(`${i === 0 ? "  • " : "    "}${p(line, RED)}`));
    }
  }
  return out.join("\n");
}
