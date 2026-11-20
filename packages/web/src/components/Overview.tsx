import type { RepoIndex } from "../types.ts";
import { Progress } from "./Progress.tsx";
import { RepoCounts } from "./RepoCounts.tsx";
import { ToolsByUse } from "./ToolsByUse.tsx";

export function Overview({ index }: { index: RepoIndex }) {
  return (
    <main className="overview">
      <h1>Repositories</h1>
      {index.problem === undefined ? null : <p className="problems" role="alert">The list could not be read, so the last good one is shown: {index.problem}</p>}
      {index.repos.length === 0 ? <p className="muted">No repository is listed yet. Add one from the sidebar: tally can track any git repository under {index.workspace}.</p> : null}
      <div className="overview-grid">
        {index.repos.map((repo) => (
          <article key={repo.name} className="panel overview-card">
            <div className="panel-head">
              <h2><a href={`/r/${repo.name}/`}>{repo.name}</a></h2>
              <span className="muted small">{repo.project}</span>
            </div>
            <div className="panel-body">
              <Progress share={repo.overall} label={repo.name} big />
              <RepoCounts repo={repo} />
              <p className="mono muted truncate">{repo.root}</p>
              {repo.problem === undefined ? null : <p className="problems" role="alert">{repo.problem}</p>}
            </div>
          </article>
        ))}
      </div>
      <ToolsByUse />
    </main>
  );
}
