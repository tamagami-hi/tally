import { useEffect } from "react";
import { Overview } from "./components/Overview.tsx";
import { Frame } from "./Frame.tsx";
import { useDocs, useEvidence, useLayout, useScheme, useSnapshot } from "./live.ts";
import { here } from "./place.ts";
import { useRepos } from "./repos.ts";
import { Shell } from "./Shell.tsx";

export function App() {
  const place = here();
  const index = useRepos();
  const wantsBoard = index === null || (index !== undefined && place.repo !== null);
  const { snapshot, error, live, retry } = useSnapshot(place, wantsBoard);
  const layout = useLayout();
  const [scheme, toggleScheme] = useScheme();
  const evidence = useEvidence(snapshot?.takenAt, place.api);
  const docs = useDocs(snapshot?.takenAt, place.api);
  useEffect(() => {
    document.documentElement.dataset["theme"] = scheme;
  }, [scheme]);
  const board = <Shell snapshot={snapshot} error={error} live={live} layout={layout} scheme={scheme} evidence={evidence} docs={docs} onToggleScheme={toggleScheme} onRetry={retry} />;
  if (index === undefined || index === null) return board;
  return (
    <Frame index={index} current={place.repo} layout={layout}>
      {place.repo === null ? <Overview index={index} /> : board}
    </Frame>
  );
}
