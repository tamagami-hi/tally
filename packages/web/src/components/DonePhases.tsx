import { CheckIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { countsLine, momentText, partText } from "../done-text.ts";
import { percent, tone } from "../format.ts";
import type { DoneMilestone, DonePhase, DoneTask, DoneWork } from "../types.ts";

const DATED: Record<NonNullable<DoneTask["dated"]>, string> = { recorded: "recorded when it landed", commit: "the date of its commit; the landing recorded none" };
const UNDATED = "its commit was not found on main";

function When({ task }: { task: DoneTask }) {
  if (task.at === undefined) return <span className="faint small" title={UNDATED}>no date</span>;
  return <span className="mono faint" title={DATED[task.dated ?? "commit"]}>{momentText(task.at)}</span>;
}

function Task({ task }: { task: DoneTask }) {
  return (
    <li className="done-task">
      <div className="done-task-head">
        <span className="label">{task.id}</span>
        <span className="chip chip-line">{task.track}</span>
        <span className="mono">{task.commit}</span>
        {task.also.length === 0 ? null : <span className="faint small">{`+${task.also.length} more`}</span>}
        {task.checked === "tip" ? <span className="faint small" title="its landing checked the last commit alone, as it was asked to">tip only</span> : null}
        {task.under === undefined ? null : <span className="faint small" title="built on these questions' meanwhile: check it against their answers">under {task.under.join(", ")}</span>}
        <When task={task} />
      </div>
      {task.deferred === undefined ? null : (
        <ul className="parts">{task.deferred.map((part) => <li key={`${part.what}:${part.to ?? ""}`} className={`part ${part.state}`}>{partText(part)}</li>)}</ul>
      )}
    </li>
  );
}

const progressText = (row: DoneMilestone): string => (row.count === null ? "in progress" : `${row.count[0]} of ${row.count[1]} landed`);

function Milestone({ row }: { row: DoneMilestone }) {
  return (
    <li className="done-milestone">
      <details>
        <summary>
          <span className="id">{row.id}</span>
          <span className="label">{row.name}</span>
          {row.finished ? <CheckIcon aria-label="finished" className="tick" /> : <span className="faint small">{progressText(row)}</span>}
          {row.built === undefined ? null : <span className="chip chip-line">built</span>}
        </summary>
        {row.tasks.length === 0
          ? <p className="faint small done-none">{row.built === undefined ? "no landed task" : `marked built: ${row.built}`}</p>
          : <ul className="done-tasks">{row.tasks.map((task) => <Task key={task.id} task={task} />)}</ul>}
      </details>
    </li>
  );
}

function Closing({ phase }: { phase: DonePhase }) {
  const by = phase.closedBy === undefined ? "closed" : `closed by ${phase.closedBy.agent} (${phase.closedBy.track})`;
  return (
    <div className="done-closing small">
      {phase.summary === undefined ? null : <p>{phase.summary}</p>}
      <p className="faint">{phase.commit === undefined ? by : `${by} at ${phase.commit}`}</p>
    </div>
  );
}

const stateText = (phase: DonePhase): string => (phase.state === "closed" ? `closed ${phase.closedAt?.slice(0, 10) ?? ""}` : `open, ${percent(phase.share)}`);

function Phase({ phase, open }: { phase: DonePhase; open: boolean }) {
  return (
    <details className="stage done-phase" open={open}>
      <summary className="stage-head">
        <h3>Stage {phase.id}<span className="name">{phase.name}</span></h3>
        <span className={`chip mono chip-${phase.state === "closed" ? "done" : tone(phase.share)}`}>{stateText(phase)}</span>
      </summary>
      {phase.goal === undefined ? null : <p className="small stage-goal">{phase.goal}</p>}
      {phase.state === "closed" ? <Closing phase={phase} /> : null}
      <p className="faint small">{`${phase.milestones.finished} of ${phase.milestones.total} milestones finished · ${phase.tasks.landed} of ${phase.tasks.total} tasks landed`}</p>
      {phase.rows.length === 0 ? null : <ul>{phase.rows.map((row) => <Milestone key={row.id} row={row} />)}</ul>}
    </details>
  );
}

export function DonePhases({ work }: { work: DoneWork }) {
  if (work.phases.length === 0) {
    return (
      <div className="empty">
        <InfoCircledIcon aria-hidden="true" />
        <p><b>Nothing is finished yet.</b> Closed phases, finished milestones and landed tasks arrive here.</p>
      </div>
    );
  }
  return (
    <div className="done-phases">
      <p className="done-counts">{countsLine(work.counts)}</p>
      {work.phases.map((phase, index) => <Phase key={phase.id} phase={phase} open={index === 0} />)}
    </div>
  );
}
