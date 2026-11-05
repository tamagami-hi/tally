import { useRef } from "react";
import { paintOf } from "../branches.ts";
import { useKeptScroll, useNearBottom } from "../scroll.ts";
import type { DrawnCommit, GraphView, Stroke } from "../types.ts";

const ROW = 34;
const LANE = 12;
const PAD = 8;
const DOT = 7;
const MAIN_DOT = 9;

const x = (lane: number): number => PAD + lane * LANE;

type Palette = Pick<GraphView, "main" | "colours">;

export function Legend({ commits }: { commits: DrawnCommit[] }) {
  const local = commits.filter((c) => !c.pushed).length;
  return (
    <span className="legend">
      <span className="unpushed"><i aria-hidden="true" />not pushed · {local}</span>
      <span className="pushed"><i aria-hidden="true" />pushed to origin</span>
    </span>
  );
}

function Line({ stroke, start, palette }: { stroke: Stroke; start: number; palette: Palette }) {
  const heavy = stroke.branch === palette.main && stroke.from === stroke.to;
  return <line x1={x(stroke.from)} y1={start} x2={x(stroke.to)} y2={start + ROW / 2} className={heavy ? "lane main" : "lane"} style={paintOf(palette.colours, stroke.branch)} />;
}

function Dot({ commit, palette }: { commit: DrawnCommit; palette: Palette }) {
  const size = commit.branch === palette.main ? MAIN_DOT : DOT;
  return <rect x={x(commit.lane) - size / 2} y={(ROW - size) / 2} width={size} height={size} className={`dot ${commit.pushed ? "remote" : "local"}`} style={paintOf(palette.colours, commit.branch)} />;
}

function Label({ label, palette }: { label: string; palette: Palette }) {
  if (label === palette.main) return <span className="chip mono chip-main">{label}</span>;
  if (label.startsWith("origin/")) return <span className="chip mono chip-remote">{label}</span>;
  return <span className="chip mono chip-branch" style={paintOf(palette.colours, label)}>{label}</span>;
}

export function Graph({ view }: { view: GraphView }) {
  const { commits, hasMore, loading, failed, loadMore, retry } = view;
  const list = useRef<HTMLOListElement>(null);
  useKeptScroll(list, commits, ROW);
  useNearBottom(list, hasMore && !loading && !failed, loadMore);
  if (commits.length === 0) return <p className="muted small">No commits to draw.</p>;
  const lanes = Math.max(...commits.map((c) => c.width));
  const width = PAD * 2 + Math.max(0, lanes - 1) * LANE;
  return (
    <section className="graph" aria-label="Commit graph">
      <ol ref={list} className="graph-rows">
        {commits.map((commit) => (
          <li key={commit.hash} className={`graph-row ${commit.pushed ? "remote" : "local"}`} style={{ height: ROW }}>
            <svg width={width} height={ROW} className="graph-lanes" aria-hidden="true">
              {commit.top.map((stroke, i) => <Line key={`t${i}`} stroke={stroke} start={0} palette={view} />)}
              {commit.bottom.map((stroke, i) => <Line key={`b${i}`} stroke={stroke} start={ROW / 2} palette={view} />)}
              <Dot commit={commit} palette={view} />
            </svg>
            <div className="graph-text">
              <div className="graph-line">
                {commit.labels.map((label) => <Label key={label} label={label} palette={view} />)}
                <span className="subject truncate" title={commit.subject}>{commit.subject}</span>
              </div>
              <div className="graph-meta truncate"><span className="hash">{commit.hash}</span> · {commit.author} · {commit.when}</div>
            </div>
          </li>
        ))}
      </ol>
      {hasMore && loading ? <p className="graph-status muted small" role="status">Loading more commits…</p> : null}
      {hasMore && failed ? <p className="graph-status muted small" role="alert">Could not load more commits. <button type="button" className="button" onClick={retry}>Try again</button></p> : null}
    </section>
  );
}
