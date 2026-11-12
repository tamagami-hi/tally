import type { RepoSummary } from "../types.ts";

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function RepoCounts({ repo }: { repo: RepoSummary }) {
  return (
    <span className="repo-counts">
      {repo.isDefault ? <span className="chip chip-accent">default</span> : null}
      {repo.sessions > 0 ? <span className="chip chip-active">{repo.sessions} working</span> : null}
      {repo.questions > 0 ? <span className="chip chip-remote">{repo.questions} to answer</span> : null}
      {repo.problems > 0 ? <span className="chip chip-warn">{plural(repo.problems, "problem", "problems")}</span> : null}
    </span>
  );
}
