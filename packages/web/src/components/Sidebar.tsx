import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { percent } from "../format.ts";
import type { RepoIndex, RepoSummary } from "../types.ts";
import { Bar } from "./Progress.tsx";
import { RepoCounts } from "./RepoCounts.tsx";

export interface SidebarProps {
  index: RepoIndex;
  current: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onDefault: (name: string) => void;
}

interface RowProps {
  repo: RepoSummary;
  current: boolean;
  collapsed: boolean;
  onRemove: (name: string) => void;
  onDefault: (name: string) => void;
}

function Row({ repo, current, collapsed, onRemove, onDefault }: RowProps) {
  const [asking, setAsking] = useState(false);
  const link = (
    <a href={`/r/${repo.name}/`} title={repo.root} aria-current={current ? "page" : undefined} aria-label={repo.name}>
      <span className="repo-mark" aria-hidden="true">{repo.name.slice(0, 2)}</span>
      {collapsed ? null : <span className="repo-name truncate">{repo.name}</span>}
      {collapsed ? null : <span className="pct">{percent(repo.overall)}</span>}
    </a>
  );
  if (collapsed) return <li className={current ? "repo current" : "repo"}>{link}</li>;
  return (
    <li className={current ? "repo current" : "repo"}>
      {link}
      <Bar share={repo.overall} />
      <RepoCounts repo={repo} />
      {repo.problem === undefined ? null : <p className="repo-problem small" role="alert">{repo.problem}</p>}
      {asking ? (
        <div className="repo-ask small">
          <p>Remove {repo.name} from the list? Its records stay in the repository.</p>
          <button type="button" className="link warn" onClick={() => onRemove(repo.name)}>Remove</button>
          <button type="button" className="link" onClick={() => setAsking(false)}>Keep</button>
        </div>
      ) : (
        <div className="repo-actions small">
          {repo.isDefault ? null : <button type="button" className="link" aria-label={`Make ${repo.name} the default`} onClick={() => onDefault(repo.name)}>Make default</button>}
          <button type="button" className="link" aria-label={`Remove ${repo.name}`} onClick={() => setAsking(true)}>Remove</button>
        </div>
      )}
    </li>
  );
}

export function Sidebar({ index, current, collapsed, onToggle, onAdd, onRemove, onDefault }: SidebarProps) {
  return (
    <nav className={collapsed ? "sidebar collapsed" : "sidebar"} aria-label="Repositories">
      <div className="sidebar-head">
        <button type="button" className="icon-button" aria-label={collapsed ? "Show repositories" : "Hide repositories"} aria-expanded={!collapsed} onClick={onToggle}>
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        {collapsed ? null : <a href="/" className="sidebar-title">Repositories</a>}
      </div>
      {index.repos.length === 0 && !collapsed ? <p className="muted small">No repository yet.</p> : null}
      <ul className="repos">
        {index.repos.map((repo) => (
          <Row key={repo.name} repo={repo} current={repo.name === current} collapsed={collapsed} onRemove={onRemove} onDefault={onDefault} />
        ))}
      </ul>
      <button type="button" className={collapsed ? "icon-button" : "button"} aria-label="Add repository" onClick={onAdd}>
        {collapsed ? <PlusIcon /> : "Add repository"}
      </button>
    </nav>
  );
}
