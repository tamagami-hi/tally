import { Half2Icon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import { percent, sinceText, tone } from "../format.ts";
import type { Live, StatusData } from "../types.ts";
import type { Scheme } from "../live.ts";
import { Bar, Progress } from "./Progress.tsx";

interface TopBarProps {
  status: StatusData;
  live: Live;
  takenAt: string;
  scheme: Scheme;
  onToggleScheme: () => void;
}

const LIVE: Record<Live, string> = { connected: "Live", reconnecting: "Reconnecting", offline: "Offline" };

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function TopBar({ status, live, takenAt, scheme, onToggleScheme }: TopBarProps) {
  const now = useNow();
  const first = status.stages[0]?.id;
  const last = status.stages[status.stages.length - 1]?.id;
  const range = first === undefined ? "" : last === undefined || last === first ? `Stage ${first}` : `Stages ${first} to ${last}`;
  return (
    <header className="topbar">
      <div>
        <h1>{status.name} build status</h1>
        <p className="sub">{range}, every branch and its uncommitted work, from git and the ledger</p>
      </div>
      <div className="topbar-right">
        <span className={`live ${live}`}>
          <i aria-hidden="true" />
          {LIVE[live]} · updated {sinceText(takenAt, now)}
        </span>
        <button type="button" className="icon-button" aria-label={scheme === "dark" ? "Switch to light" : "Switch to dark"} onClick={onToggleScheme}>
          <Half2Icon />
        </button>
      </div>
    </header>
  );
}

export function Hero({ status }: { status: StatusData }) {
  return (
    <section className="panel hero" aria-label="Overall progress">
      <div className="hero-total">
        <div className="label">Overall</div>
        <div className={`number ${tone(status.overall)}`} aria-label={`Overall ${percent(status.overall)}`}>{percent(status.overall)}</div>
        <Bar share={status.overall} big />
      </div>
      <div className="hero-stages">
        {status.stages.map((stage) => {
          const share = status.stagePct[stage.id] ?? 0;
          return (
            <div key={stage.id} className="stage-line">
              <span className="small" style={{ fontWeight: 600 }}>Stage {stage.id}</span>
              <Progress share={share} withPercent={false} label={`Stage ${stage.id}`} />
              <span className={`pct ${tone(share)}`}>{percent(share)}</span>
              <span className="name truncate">{stage.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
