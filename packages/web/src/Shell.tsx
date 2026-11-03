import { Button, Callout, SegmentedControl, Skeleton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { Board } from "./components/Board.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { Graph } from "./components/Graph.tsx";
import { Header } from "./components/Header.tsx";
import { Panel } from "./components/Panel.tsx";
import { Problems } from "./components/Problems.tsx";
import { Tracks } from "./components/Tracks.tsx";
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
      <Skeleton height="72px" />
      <Skeleton height="48%" />
      <Skeleton height="40%" />
    </div>
  );
}

function Failed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="shell failed">
      <Callout.Root color="tomato" variant="surface">
        <Callout.Text>
          <Text weight="medium">The board could not reach tally.</Text> {error.message}
        </Callout.Text>
      </Callout.Root>
      <Button variant="soft" onClick={onRetry}>Try again</Button>
    </div>
  );
}

export function Shell({ snapshot, error, live, layout, scheme, onToggleScheme, onRetry }: ShellProps) {
  const [page, setPage] = useState<Page>("board");
  if (snapshot === undefined) return error === null ? <Loading /> : <Failed error={error} onRetry={onRetry} />;
  const { status, graph } = snapshot;
  const header = <Header status={status} live={live} layout={layout} scheme={scheme} onToggleScheme={onToggleScheme} />;
  if (layout === "landscape") {
    return (
      <div className="shell landscape">
        {header}
        <Problems problems={status.problems} />
        <Panel title="Tracks" detail={`${status.tracks.length} branches`} area="tracks"><Tracks status={status} /></Panel>
        <Panel title="Board" detail={`${status.rows.length} milestones`} area="board"><Board status={status} /></Panel>
        <Panel title="Graph" detail={`${graph.length} commits`} area="graph"><Graph commits={graph} /></Panel>
      </div>
    );
  }
  return (
    <div className="shell portrait">
      {header}
      <Problems problems={status.problems} />
      <main className="page">
        {page === "board" ? <Board status={status} /> : null}
        {page === "tracks" ? <Tracks status={status} /> : null}
        {page === "graph" ? <Graph commits={graph} /> : null}
        {page === "evidence" ? <Evidence /> : null}
      </main>
      <nav className="bottom-nav" aria-label="Pages">
        <SegmentedControl.Root value={page} onValueChange={(value) => setPage(value as Page)} size="2" radius="medium">
          {PAGES.map((p) => <SegmentedControl.Item key={p.id} value={p.id}>{p.label}</SegmentedControl.Item>)}
        </SegmentedControl.Root>
      </nav>
    </div>
  );
}
