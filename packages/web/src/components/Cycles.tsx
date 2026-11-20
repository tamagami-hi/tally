import { useState } from "react";
import { useCycleDone, useCycles, type Loaded } from "../live.ts";
import type { ClosedCycle, CurrentCycle, Released } from "../types.ts";
import { DonePhases } from "./DonePhases.tsx";

const LOCALE = "en-GB";

const when = (time: string): string => new Date(time).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });

function Failure<T>({ state, what }: { state: Loaded<T>; what: string }) {
  if (state.failed === undefined) return null;
  return (
    <div className="problems" role="alert">
      <div>{`${what} could not be read: ${state.failed}.`} <button type="button" className="button" onClick={state.retry}>Try again</button></div>
    </div>
  );
}

function Releases({ releases }: { releases: Released[] | undefined }) {
  if (releases === undefined || releases.length === 0) return null;
  return <p className="small" title={releases.map((one) => `${one.version} at ${one.commit}`).join(", ")}>{`released ${releases.map((one) => one.version).join(", ")}`}</p>;
}

function Current({ cycle }: { cycle: CurrentCycle }) {
  const label = `Cycle ${cycle.n}, the current cycle`;
  return (
    <section className="cycle current" aria-label={label}>
      <h3>{label}</h3>
      <p className="small">{`${cycle.milestones.finished} of ${cycle.milestones.open + cycle.milestones.finished} milestones finished · ${cycle.tasks.landed} of ${cycle.tasks.total} tasks landed`}{cycle.since === undefined ? "" : ` · since ${when(cycle.since)}`}</p>
      <Releases releases={cycle.releases} />
      {cycle.ask === undefined ? null : <p className="cycle-ask">{cycle.ask}</p>}
    </section>
  );
}

function Unfolded({ n }: { n: number }) {
  const done = useCycleDone(n, true);
  return (
    <>
      <Failure state={done} what={`Cycle ${n}'s work`} />
      {done.data === undefined ? (done.failed === undefined ? <div className="skeleton evidence-skeleton" /> : null) : <DonePhases work={done.data} />}
    </>
  );
}

function Closed({ cycle }: { cycle: ClosedCycle }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="cycle" role="group" aria-label={`Cycle ${cycle.n}`}>
      <h3>{cycle.name === undefined ? `Cycle ${cycle.n}` : `Cycle ${cycle.n}: ${cycle.name}`}</h3>
      <p className="faint small">{`closed ${when(cycle.closedAt)} by ${cycle.closedBy.agent} · ${cycle.milestones} milestones · ${cycle.tasks} tasks · ${cycle.from}..${cycle.to}`}</p>
      <p>{cycle.summary}</p>
      <Releases releases={cycle.releases} />
      {cycle.said === undefined ? null : <blockquote className="cycle-said small">{`“${cycle.said}”`}</blockquote>}
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="small">Phases, milestones and tasks</summary>
        {open ? <Unfolded n={cycle.n} /> : null}
      </details>
    </article>
  );
}

export function Cycles({ version }: { version: string }) {
  const cycles = useCycles(version);
  const data = cycles.data;
  return (
    <section className="cycles" aria-label="Cycles" aria-busy={data === undefined && cycles.failed === undefined}>
      <Failure state={cycles} what="The cycles" />
      {data === undefined ? (cycles.failed === undefined ? <div className="skeleton evidence-skeleton" /> : null) : (
        <>
          <Current cycle={data.current} />
          {data.closed.length === 0
            ? <p className="muted">No cycle has been closed yet: cycle_close closes the current one, on the operator's word.</p>
            : data.closed.map((cycle) => <Closed key={cycle.n} cycle={cycle} />)}
          {data.matched > data.closed.length ? <p className="faint small">{`The newest ${data.closed.length} of ${data.matched} closed cycles are shown.`}</p> : null}
        </>
      )}
    </section>
  );
}
