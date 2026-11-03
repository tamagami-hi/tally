import { percent, tone } from "../format.ts";

interface ProgressProps {
  share: number;
  label?: string;
  big?: boolean;
  withPercent?: boolean;
}

export function Bar({ share, big = false }: { share: number; big?: boolean }) {
  return (
    <span className={`bar ${tone(share)} ${big ? "big" : ""}`} role="presentation">
      <i style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}

export function Progress({ share, label, big = false, withPercent = true }: ProgressProps) {
  const t = tone(share);
  return (
    <div className="progress" aria-label={label === undefined ? undefined : `${label} ${percent(share)}`}>
      <Bar share={share} big={big} />
      {withPercent ? <span className={`pct ${t}`}>{percent(share)}</span> : null}
    </div>
  );
}
