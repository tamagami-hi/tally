import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  detail?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, detail, className = "", children }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {detail === undefined ? null : <span className="muted small">{detail}</span>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
