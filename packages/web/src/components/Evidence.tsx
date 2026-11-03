import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { bytesText, countsText, kindTone, secondsText, summaryText } from "../format.ts";
import type { EvidenceIndex, EvidenceRecord } from "../types.ts";

const basename = (path: string): string => path.split("/").at(-1) ?? path;

function LogView({ record }: { record: EvidenceRecord }) {
  const [text, setText] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  if (record.log === undefined) return <span className="faint small">no log</span>;
  const log = record.log;
  const load = async (): Promise<void> => {
    if (text !== undefined || failed !== undefined) return;
    try {
      const response = await fetch(`/api/evidence/log/${record.id}`);
      if (!response.ok) {
        setFailed(`the server answered ${response.status}`);
        return;
      }
      setText(await response.text());
    } catch (error: unknown) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <details className="log" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
      <summary><span className="mono">{basename(log.path)}</span> <span className="faint">{bytesText(log.bytes)}</span></summary>
      {failed !== undefined ? <p className="log-failed small">{failed}</p> : <pre>{text ?? "loading…"}</pre>}
    </details>
  );
}

function Run({ record }: { record: EvidenceRecord }) {
  const command = record.command.join(" ");
  return (
    <li className={`run ${kindTone(record.kind)}`}>
      <span className={`chip chip-${kindTone(record.kind)}`}>{record.kind}</span>
      <span className="mono">exit {record.exit}</span>
      <span className="mono">{secondsText(record.seconds)}</span>
      <span className="faint small">{new Date(record.started).toLocaleString()}</span>
      <span className="cmd truncate mono" title={command}>{command}</span>
      <span className="meta small">
        {record.summary === undefined ? null : <span>{summaryText(record.summary)}</span>}
        <LogView record={record} />
      </span>
    </li>
  );
}

function Task({ task, records }: { task: string; records: EvidenceRecord[] }) {
  return (
    <li className="evidence-task">
      <div className="evidence-task-head">
        <span className="label">{task}</span>
        <span className="faint small">{countsText(records)}</span>
      </div>
      <ul className="runs">{records.map((record) => <Run key={record.id} record={record} />)}</ul>
    </li>
  );
}

function byTask(records: EvidenceRecord[]): [string, EvidenceRecord[]][] {
  const tasks = new Map<string, EvidenceRecord[]>();
  for (const record of records) tasks.set(record.task, [...(tasks.get(record.task) ?? []), record]);
  return [...tasks];
}

export function Evidence({ index }: { index: EvidenceIndex | undefined }) {
  if (index === undefined) return <section className="evidence" aria-label="Evidence" aria-busy="true"><div className="skeleton evidence-skeleton" /></section>;
  const total = index.milestones.reduce((n, m) => n + m.records.length, 0);
  if (total === 0) {
    return (
      <section className="evidence" aria-label="Evidence">
        <div className="empty">
          <InfoCircledIcon aria-hidden="true" />
          <p>
            <b>No evidence records yet.</b> Run records (tests seen failing and passing, clippy, formatting, landings) arrive once sessions record them under <span className="mono">docs/records/evidence/</span>, or <span className="mono">tally import evidence</span> indexes a track's folder.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="evidence" aria-label="Evidence">
      {index.milestones.map((milestone) => (
        <div key={milestone.milestone} className="stage">
          <div className="stage-head">
            <h3>{milestone.milestone}<span className="name">{milestone.records.length} run records</span></h3>
            <span className="faint small">{countsText(milestone.records)}</span>
          </div>
          <ul>{byTask(milestone.records).map(([task, records]) => <Task key={task} task={task} records={records} />)}</ul>
        </div>
      ))}
    </section>
  );
}
