import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { bytesText, countsText, kindTone, secondsText, summaryText } from "../format.ts";
import type { EvidenceIndex, EvidenceRecord, ManualCheck } from "../types.ts";
import { here } from "../place.ts";

const basename = (path: string): string => path.split("/").at(-1) ?? path;

const SHORT_HEAD = 7;

function ranOn(record: EvidenceRecord): string | null {
  if (record.head === undefined) return null;
  const head = `head ${record.head.slice(0, SHORT_HEAD)}`;
  return record.dirty === true ? `${head}, with uncommitted changes` : head;
}

function LogView({ record }: { record: EvidenceRecord }) {
  const [text, setText] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  if (record.log === undefined) return <span className="faint small">no log</span>;
  const log = record.log;
  const load = async (): Promise<void> => {
    if (text !== undefined || failed !== undefined) return;
    try {
      const response = await fetch(`${here().api}/evidence/log/${record.id}`);
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
  const head = ranOn(record);
  return (
    <li className={`run ${kindTone(record.kind)}`}>
      <span className={`chip chip-${kindTone(record.kind)}`}>{record.label ?? record.kind}</span>
      <span className="mono">exit {record.exit}</span>
      <span className="mono">{secondsText(record.seconds)}</span>
      <span className="faint small">{new Date(record.started).toLocaleString()}</span>
      <span className="cmd truncate mono" title={command}>{command}</span>
      <span className="meta small">
        {record.summary === undefined ? null : <span>{summaryText(record.summary)}</span>}
        {record.scope === undefined ? null : <span>ran: {record.scope}</span>}
        {head === null ? null : <span className="mono" title={record.cwd}>{head}</span>}
        <LogView record={record} />
      </span>
    </li>
  );
}

function whoText(check: ManualCheck): string {
  const on = check.device === undefined ? check.who : `${check.who} on ${check.device}`;
  return check.build === undefined ? on : `${on}, build ${check.build}`;
}

function Manual({ check }: { check: ManualCheck }) {
  const tone = check.result === "pass" ? "done" : "warn";
  return (
    <li className={`run manual ${tone}`}>
      <span className={`chip chip-${tone}`}>by hand: {check.result}</span>
      <span className="small">{whoText(check)}</span>
      <span className="faint small">{new Date(check.at).toLocaleString()}</span>
      <span className="cmd truncate" title={check.steps.join("\n")}>{check.steps.join("; ")}</span>
      <span className="meta small">
        {check.note === undefined ? null : <span>{check.note}</span>}
        {check.attachments.map((file) => <span key={file.path} className="mono" title={file.path}>{basename(file.path)} <span className="faint">{bytesText(file.bytes)}</span></span>)}
      </span>
    </li>
  );
}

interface TaskWork {
  records: EvidenceRecord[];
  manual: ManualCheck[];
}

function Task({ task, work }: { task: string; work: TaskWork }) {
  return (
    <li className="evidence-task">
      <div className="evidence-task-head">
        <span className="label">{task}</span>
        <span className="faint small">{countsText(work.records)}</span>
      </div>
      <ul className="runs">
        {work.records.map((record) => <Run key={record.id} record={record} />)}
        {work.manual.map((check) => <Manual key={check.id} check={check} />)}
      </ul>
    </li>
  );
}

function byTask(records: EvidenceRecord[], manual: ManualCheck[]): [string, TaskWork][] {
  const tasks = new Map<string, TaskWork>();
  const of = (task: string): TaskWork => tasks.get(task) ?? { records: [], manual: [] };
  for (const record of records) tasks.set(record.task, { ...of(record.task), records: [...of(record.task).records, record] });
  for (const check of manual) tasks.set(check.task, { ...of(check.task), manual: [...of(check.task).manual, check] });
  return [...tasks];
}

export function Evidence({ index }: { index: EvidenceIndex | undefined }) {
  if (index === undefined) return <section className="evidence" aria-label="Evidence" aria-busy="true"><div className="skeleton evidence-skeleton" /></section>;
  const total = index.milestones.reduce((n, m) => n + m.records.length + (m.manual ?? []).length, 0);
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
            <h3>{milestone.milestone}<span className="name">{milestone.records.length} run records{milestone.manual === undefined ? "" : `, ${milestone.manual.length} by hand`}</span></h3>
            <span className="faint small">{countsText(milestone.records)}</span>
          </div>
          <ul>{byTask(milestone.records, milestone.manual ?? []).map(([task, work]) => <Task key={task} task={task} work={work} />)}</ul>
        </div>
      ))}
    </section>
  );
}
