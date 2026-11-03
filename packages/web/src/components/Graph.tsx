import { Badge, Text } from "@radix-ui/themes";
import type { LaidCommit } from "../types.ts";

const ROW = 40;
const LANE = 16;
const PAD = 12;
const DOT = 4.5;

const x = (lane: number): number => PAD + lane * LANE;
const y = (row: number): number => row * ROW + ROW / 2;

export function Graph({ commits }: { commits: LaidCommit[] }) {
  if (commits.length === 0) {
    return <Text size="2" color="gray">No commits to draw.</Text>;
  }
  const lanes = Math.max(...commits.map((c) => c.width));
  const width = PAD * 2 + Math.max(0, lanes - 1) * LANE;
  return (
    <section className="graph" aria-label="Commit graph">
      <ol className="graph-rows">
        {commits.map((commit, row) => (
          <li key={commit.hash} className={`graph-row ${commit.pushed ? "pushed" : "local"}`}>
            <svg width={width} height={ROW} className="graph-lanes" aria-hidden="true">
              {commit.top.map(([from, to], i) => (
                <path key={`t${i}`} d={`M ${x(from)} 0 C ${x(from)} ${ROW / 4}, ${x(to)} ${ROW / 4}, ${x(to)} ${ROW / 2}`} className={`lane lane-${from % 6}`} />
              ))}
              {commit.bottom.map(([from, to], i) => (
                <path key={`b${i}`} d={`M ${x(from)} ${ROW / 2} C ${x(from)} ${(ROW * 3) / 4}, ${x(to)} ${(ROW * 3) / 4}, ${x(to)} ${ROW}`} className={`lane lane-${to % 6}`} />
              ))}
              <circle cx={x(commit.lane)} cy={y(0)} r={DOT} className={`dot lane-${commit.lane % 6}`} />
            </svg>
            <div className="graph-text">
              <div className="graph-line">
                <Text size="1" className="mono hash" color={commit.pushed ? "gray" : undefined}>{commit.hash}</Text>
                {commit.labels.map((label) => (
                  <Badge key={label} size="1" variant={label.startsWith("origin/") ? "outline" : "soft"} color={label === "main" ? "indigo" : label.startsWith("origin/") ? "gray" : "amber"} radius="medium" className="mono">{label}</Badge>
                ))}
                <Text size="1" color="gray" className="when">{commit.when}</Text>
              </div>
              <Text size="2" truncate title={commit.subject} className="subject">{commit.subject}</Text>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
