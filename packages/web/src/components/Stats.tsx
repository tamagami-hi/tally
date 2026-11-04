import type { ReactNode } from "react";
import type { StatusData } from "../types.ts";

interface StatProps {
  label: string;
  value: string | number;
  detail: ReactNode;
  title?: string;
  mono?: boolean;
}

function Stat({ label, value, detail, title, mono = false }: StatProps) {
  return (
    <div className="panel stat">
      <div className="stat-label">{label}</div>
      <div className={mono ? "stat-value mono" : "stat-value"}>{value}</div>
      <div className="stat-detail truncate" title={title}>{detail}</div>
    </div>
  );
}

function questionsDetail({ questions, nextRow }: StatusData): string {
  const open = questions.length === 0 ? "none open" : questions.join(", ");
  return nextRow === null ? open : `${open} · next row ${nextRow}`;
}

export function Stats({ status }: { status: StatusData }) {
  const subject = status.main.slice(8);
  const questions = questionsDetail(status);
  const origin = status.origin === null ? "no origin" : <>origin at <code className="mono">{status.origin}</code></>;
  return (
    <section className="stats" aria-label="Repository">
      <Stat label="Main" value={status.main.slice(0, 7)} detail={subject} title={subject} mono />
      <Stat label="Unpushed" value={status.unpushed} detail={origin} />
      <Stat label="Commits today" value={status.today} detail="on main" />
      <Stat label="Open questions" value={status.questions.length} detail={questions} title={questions} />
    </section>
  );
}
