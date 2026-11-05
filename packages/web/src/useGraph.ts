import { useCallback, useEffect, useMemo, useState } from "react";
import { branchColours, mainOf } from "./branches.ts";
import { forkLanes } from "./lanes.ts";
import type { GraphPage, GraphView, LaidCommit, Snapshot, TrackRow } from "./types.ts";

const BATCH = 100;
const NOTHING: LaidCommit[] = [];
const NO_TRACKS: TrackRow[] = [];

async function fetchGraph(limit: number): Promise<GraphPage> {
  const response = await fetch(`/api/graph?limit=${limit}`);
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as GraphPage;
}

const versionOf = (commits: readonly LaidCommit[], total: number): string =>
  `${total} ${commits.map((c) => `${c.hash}:${c.pushed}:${c.labels.join()}`).join(" ")}`;

export function useGraph(snapshot: Snapshot | undefined): GraphView {
  const live = snapshot?.graph ?? NOTHING;
  const tracks = snapshot?.status.tracks ?? NO_TRACKS;
  const total = snapshot?.graphTotal ?? 0;
  const [remaining, setRemaining] = useState<number | null>(null);
  const [page, setPage] = useState<GraphPage | null>(null);
  const [progress, setProgress] = useState<"idle" | "loading" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const limit = remaining === null ? null : Math.max(total - remaining, live.length);
  const version = versionOf(live, total);
  useEffect(() => {
    if (limit === null) return undefined;
    let current = true;
    setProgress("loading");
    fetchGraph(limit).then(
      (fetched) => {
        if (!current) return;
        setPage(fetched);
        setProgress("idle");
      },
      () => {
        if (current) setProgress("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [limit, version, attempt]);
  const laid = page !== null && page.commits.length >= live.length ? page.commits : live;
  const shown = laid.length;
  const main = mainOf(tracks);
  const colours = useMemo(() => branchColours(tracks), [tracks]);
  const commits = useMemo(() => forkLanes(laid, main, [...colours.keys()]), [laid, main, colours]);
  const loadMore = useCallback(() => setRemaining(Math.max(0, total - shown - BATCH)), [total, shown]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { commits, main, colours, hasMore: shown < total, loading: progress === "loading", failed: progress === "failed", loadMore, retry };
}
