import { useRef } from "react";
import { useKeptScroll, useNearBottom } from "../scroll.ts";
import type { GraphView, LaidCommit } from "../types.ts";

const ROW = 44;
const LANE = 16;
const PAD = 12;
const DOT = 4.5;

const x = (lane: number): number => PAD + lane * LANE;

export function Legend({ commits }: { commits: LaidCommit[] }) {
  const local = commits.filter((c) => !c.pushed).length;
  return (
    <span className="legend">
      <span className="unpushed"><i aria-hidden="true" />not pushed · {local}</span>
      <span className="pushed"><i aria-hidden="true" />pushed to origin</span>
    </span>
  );
}

export function Graph({ view }: { view: GraphView }) {
  const { commits, hasMore, loading, failed, loadMore, retry } = view;
  const list = useRef<HTMLOListElement>(null);
  useKeptScroll(list, commits, ROW);
  useNearBottom(list, hasMore && !loading && !failed, loadMore);
  if (commits.length === 0) return <p className="muted small">No commits to draw.</p>;
  const lanes = Math.max(...commits.map((c) => c.width));
  const width = PAD * 2 + Math.max(0, lanes - 1) * LANE;
  const pushedAt = new Map(commits.map((c) => [c.hash, c.pushed]));
  return (
    <section className="graph" aria-label="Commit graph">
      <ol ref={list} className="graph-rows">
        {commits.map((commit) => {
          const kind = commit.pushed ? "remote" : "local";
          return (
            <li key={commit.hash} className={`graph-row ${kind}`}>
              <svg width={width} height={ROW} className="graph-lanes" aria-hidden="true">
                {commit.top.map(([from, to], i) => (
                  <path key={`t${i}`} d={`M ${x(from)} 0 C ${x(from)} ${ROW / 4}, ${x(to)} ${ROW / 4}, ${x(to)} ${ROW / 2}`} className={`lane ${kind}`} />
                ))}
                {commit.bottom.map(([from, to], i) => {
                  const parent = commit.parents[i - (commit.bottom.length - commit.parents.length)];
                  const parentPushed = parent === undefined ? commit.pushed : (pushedAt.get(parent) ?? true);
                  return <path key={`b${i}`} d={`M ${x(from)} ${ROW / 2} C ${x(from)} ${(ROW * 3) / 4}, ${x(to)} ${(ROW * 3) / 4}, ${x(to)} ${ROW}`} className={`lane ${parentPushed && commit.pushed ? "remote" : "local"}`} />;
                })}
                <circle cx={x(commit.lane)} cy={ROW / 2} r={DOT} className={`dot ${kind}`} />
              </svg>
              <div className="graph-text">
                <div className="graph-line">
                  {commit.labels.map((label) => (
                    <span key={label} className={`chip mono ${label === "main" ? "chip-accent" : label.startsWith("origin/") ? "chip-remote" : "chip-active"}`}>{label}</span>
                  ))}
                  <span className="subject truncate" title={commit.subject}>{commit.subject}</span>
                </div>
                <div className="graph-meta truncate"><span className="hash">{commit.hash}</span> · {commit.author} · {commit.when}</div>
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && loading ? <p className="graph-status muted small" role="status">Loading more commits…</p> : null}
      {hasMore && failed ? <p className="graph-status muted small" role="alert">Could not load more commits. <button type="button" className="button" onClick={retry}>Try again</button></p> : null}
    </section>
  );
}
