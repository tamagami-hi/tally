import { useState } from "react";
import { Board } from "./components/Board.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { Graph, Legend } from "./components/Graph.tsx";
import { Hero, TopBar } from "./components/Header.tsx";
import { Panel } from "./components/Panel.tsx";
import { Problems } from "./components/Problems.tsx";
import { Tracks, tracksSummary } from "./components/Tracks.tsx";
import type { Scheme } from "./live.ts";
import type { Layout, Live, Page, Snapshot } from "./types.ts";

export interface ShellProps {
  snapshot: Snapshot | undefined;
  error: Error | null;
  live: Live;
  layout: Layout;
  scheme: Scheme;
  onToggleScheme: () => void;
  onRetry: () => void;
}

const PAGES: { id: Page; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "tracks", label: "Tracks" },
  { id: "graph", label: "Graph" },
  { id: "evidence", label: "Evidence" },
];

function Loading() {
  return (
    <div className="shell loading" aria-busy="true" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function Failed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="shell failed">
      <div className="problems" role="alert"><div><strong>The board could not reach tally.</strong> {error.message}</div></div>
      <div><button type="button" className="button" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

export function Shell({ snapshot, error, live, layout, scheme, onToggleScheme, onRetry }: ShellProps) {
  const [page, setPage] = useState<Page>("board");
  if (snapshot === undefined) return error === null ? <Loading /> : <Failed error={error} onRetry={onRetry} />;
  const { status, graph } = snapshot;
  const top = <TopBar status={status} live={live} takenAt={snapshot.takenAt} scheme={scheme} onToggleScheme={onToggleScheme} />;
  if (layout === "landscape") {
    return (
      <div className="shell landscape">
        {top}
        <Problems problems={status.problems} />
        <div className="column-left"><Panel title="Branches" detail={tracksSummary(status)} className="column-left"><Tracks status={status} /></Panel></div>
        <div className="column-main">
          <Hero status={status} />
          <Panel title="Board" detail={`${status.rows.length} milestones`}><Board status={status} /></Panel>
        </div>
        <div className="column-right"><Panel title="Graph" detail={<Legend commits={graph} />} className="column-right"><Graph commits={graph} /></Panel></div>
      </div>
    );
  }
  return (
    <div className="shell portrait">
      {top}
      <Problems problems={status.problems} />
      <Hero status={status} />
      <main className="page">
        {page === "board" ? <Panel title="Board" detail={`${status.rows.length} milestones`}><Board status={status} /></Panel> : null}
        {page === "tracks" ? <Panel title="Branches" detail={tracksSummary(status)}><Tracks status={status} /></Panel> : null}
        {page === "graph" ? <Panel title="Graph" detail={<Legend commits={graph} />}><Graph commits={graph} /></Panel> : null}
        {page === "evidence" ? <Panel title="Evidence"><Evidence /></Panel> : null}
      </main>
      <nav className="bottom-nav" role="radiogroup" aria-label="Pages">
        {PAGES.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={page === p.id} onClick={() => setPage(p.id)}>{p.label}</button>
        ))}
      </nav>
    </div>
  );
}
