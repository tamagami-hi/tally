import { InfoCircledIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { SESSIONS_STEP, counted, dayText, endedText, spanText } from "../done-text.ts";
import type { EndedSession, EndedSessions } from "../types.ts";

interface DoneSessionsProps {
  ended: EndedSessions;
  canLoadMore: boolean;
  loading?: boolean;
  onMore: () => void;
}

const OPENED: Record<EndedSession["opened"], string> = { recorded: "from its opening to its last event", "first write": "from its first write (its opening was not logged) to its last event" };
const ENDED_TONE: Record<EndedSession["ended"], string> = { closed: "done", expired: "active", unknown: "idle" };

function tasksText(session: EndedSession): string {
  if (session.tasks.length === 0) return "";
  const more = session.moreTasks === undefined ? "" : ` and ${session.moreTasks} more`;
  return ` · ${session.tasks.join(", ")}${more}`;
}

function Row({ session }: { session: EndedSession }) {
  return (
    <li className="ended" data-session={session.id}>
      <div className="ended-head">
        <span className="chip chip-accent">{session.agent}</span>
        <span className="chip chip-line">{session.track}</span>
        <span className={`chip chip-${ENDED_TONE[session.ended]}`}>{endedText(session.ended)}</span>
      </div>
      <div className="ended-time small">
        <span className="mono faint">{dayText(session.from)}</span>
        <span title={OPENED[session.opened]}>{spanText(session.from, session.to)}</span>
      </div>
      <div className="ended-meta small">{`${counted(session.writes, "write", "writes")}${tasksText(session)}`}</div>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><InfoCircledIcon aria-hidden="true" /><p>{children}</p></div>;
}

const moreText = (shown: number, total: number): string => `Show ${Math.min(SESSIONS_STEP, total - shown)} more`;

const shownText = (shown: number, total: number): string => (shown === total ? counted(total, "ended session", "ended sessions") : `${shown} of ${total} ended sessions`);

export function DoneSessions({ ended, canLoadMore, loading = false, onMore }: DoneSessionsProps) {
  if (!ended.kept) {
    return <Empty><b>This repository keeps no activity log,</b> so no ended session can be listed. The config's <span className="mono">context: "records"</span> turns the log on, and sessions are listed from then on.</Empty>;
  }
  if (ended.total === 0) return <Empty><b>No session has ended yet.</b> A session is listed here once it closes or tally closes it as idle.</Empty>;
  return (
    <div className="done-sessions">
      <p className="faint small">{shownText(ended.sessions.length, ended.total)}</p>
      <ul className="ended-list">{ended.sessions.map((session) => <Row key={session.id} session={session} />)}</ul>
      {canLoadMore ? <button type="button" className="to-done" disabled={loading} onClick={onMore}>{loading ? "Loading…" : moreText(ended.sessions.length, ended.total)}</button> : null}
      {ended.earlier === undefined ? null : <p className="faint small">{`Older sessions are in the activity log: its ${counted(ended.earlier, "oldest day file is", "oldest day files are")} not read here.`}</p>}
    </div>
  );
}
