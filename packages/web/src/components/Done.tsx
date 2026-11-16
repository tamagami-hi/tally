import { useState, type ReactNode } from "react";
import { SESSIONS_STEP } from "../done-text.ts";
import { useDone, useEndedSessions, type Loaded } from "../live.ts";
import { DonePhases } from "./DonePhases.tsx";
import { DoneSessions } from "./DoneSessions.tsx";

type DoneTab = "phases" | "sessions";

const TABS: { id: DoneTab; label: string }[] = [
  { id: "phases", label: "Phases and tasks" },
  { id: "sessions", label: "Sessions" },
];

const MOST = 500;

function TabSwitch({ tab, onChange }: { tab: DoneTab; onChange: (tab: DoneTab) => void }) {
  return (
    <div className="segmented done-switch" role="radiogroup" aria-label="Done view">
      {TABS.map(({ id, label }) => (
        <button key={id} type="button" role="radio" aria-checked={tab === id} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

interface ShownProps<T> {
  state: Loaded<T>;
  what: string;
  children: (data: T) => ReactNode;
}

function Shown<T>({ state, what, children }: ShownProps<T>) {
  const failure = state.failed === undefined ? null : (
    <div className="problems" role="alert">
      <div>{`${what} could not be read: ${state.failed}.`} <button type="button" className="button" onClick={state.retry}>Try again</button></div>
    </div>
  );
  if (state.data === undefined) return failure ?? <div className="skeleton evidence-skeleton" />;
  return <>{failure}{children(state.data)}</>;
}

const isBusy = (state: Pick<Loaded<unknown>, "data" | "failed">): boolean => state.data === undefined && state.failed === undefined;

export function Done({ version }: { version: string }) {
  const [tab, setTab] = useState<DoneTab>("phases");
  const [limit, setLimit] = useState(SESSIONS_STEP);
  const work = useDone(version);
  const ended = useEndedSessions(version, tab === "sessions", limit);
  const more = (): void => setLimit((current) => Math.min(current + SESSIONS_STEP, MOST));
  return (
    <section className="done" aria-label="Done" aria-busy={isBusy(tab === "phases" ? work : ended)}>
      <TabSwitch tab={tab} onChange={setTab} />
      {tab === "phases"
        ? <Shown state={work} what="The finished work">{(data) => <DonePhases work={data} />}</Shown>
        : <Shown state={ended} what="The ended sessions">{(data) => <DoneSessions ended={data} canLoadMore={data.sessions.length < data.total && limit < MOST} loading={ended.loading} onMore={more} />}</Shown>}
    </section>
  );
}
