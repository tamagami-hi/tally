import { useCallback, useEffect, useState } from "react";
import type { RankedTool, UsageRanking } from "../types.ts";

type Read = { ranking: UsageRanking } | { failed: string } | undefined;

const COLUMNS = ["calls", "refused", "cut", "invalid", "days", "chars"] as const;
const LOCALE = "en-GB";

const numbered = (value: number): string => value.toLocaleString(LOCALE);

async function readUsage(): Promise<Read> {
  try {
    const response = await fetch("/api/usage");
    if (!response.ok) return { failed: `the server answered ${response.status}` };
    return { ranking: (await response.json()) as UsageRanking };
  } catch (error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}

function Row({ tool }: { tool: RankedTool }) {
  return (
    <tr>
      <td className="mono">{tool.listed ? tool.name : `${tool.name} (not listed)`}</td>
      {COLUMNS.map((key) => <td key={key} className="num">{numbered(tool[key])}</td>)}
    </tr>
  );
}

function Ranked({ ranking }: { ranking: UsageRanking }) {
  const versions = ranking.versions.map((one) => one.version).join(", ");
  const never = ranking.never;
  return (
    <>
      <p className="muted small">Counted since {new Date(ranking.since).toLocaleString(LOCALE)}{versions === "" ? "" : `, served by ${versions}`}.</p>
      {ranking.tools.length === 0
        ? <p className="muted">No tool has been called since counting began.</p>
        : (
          <div className="usage-scroll">
            <table className="usage-table" aria-label="Tools by use">
              <thead><tr><th scope="col">tool</th>{COLUMNS.map((key) => <th key={key} scope="col" className="num">{key}</th>)}</tr></thead>
              <tbody>{ranking.tools.map((tool) => <Row key={tool.name} tool={tool} />)}</tbody>
            </table>
          </div>
        )}
      <p className="small">Never called: {never.tools.length} tools, {numbered(never.chars)} characters of the list{never.tools.length === 0 ? "." : `: ${never.tools.join(", ")}.`}</p>
    </>
  );
}

export function ToolsByUse() {
  const [read, setRead] = useState<Read>(undefined);
  const load = useCallback(() => {
    setRead(undefined);
    void readUsage().then(setRead);
  }, []);
  useEffect(load, [load]);
  return (
    <section className="panel usage" aria-label="Tools by use">
      <div className="panel-head"><h2>Tools by use</h2></div>
      <div className="panel-body">
        {read === undefined ? <div className="skeleton" aria-busy="true" /> : null}
        {read !== undefined && "failed" in read ? <p role="alert">The count of tool calls could not be read: {read.failed}. <button type="button" className="button" onClick={load}>Try again</button></p> : null}
        {read !== undefined && "ranking" in read ? <Ranked ranking={read.ranking} /> : null}
      </div>
    </section>
  );
}
