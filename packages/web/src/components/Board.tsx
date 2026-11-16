import { ArrowRightIcon, CheckIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { percent, splitNote, tone } from "../format.ts";
import { closedLine, finishedLine, openBoard, type OpenStage } from "../open.ts";
import type { LiveClaim, MilestoneRow, StatusData } from "../types.ts";
import { Progress } from "./Progress.tsx";

interface BoardProps {
  status: StatusData;
  claims?: LiveClaim[];
  onOpenDone?: () => void;
}

const ALL_FINISHED = "Every milestone is finished. An operator session closes the phase with phase_close.";

function Milestone({ row, claims }: { row: MilestoneRow; claims: LiveClaim[] }) {
  const t = tone(row.share);
  const notes = row.notes.filter((note) => !(row.built !== undefined && note === "built"));
  return (
    <li className={`milestone ${t}`}>
      <div className="milestone-name">
        <div className="title">
          <span className="id">{row.id}</span>
          <span className="label">{row.name}</span>
          {t === "done" ? <CheckIcon aria-label="built" style={{ color: "var(--done)" }} /> : null}
        </div>
        <div className="chips">
          {row.track.split("+").map((track) => <span key={track} className="chip chip-line">{track}</span>)}
        </div>
      </div>
      <ul className="milestone-notes">
        {notes.map((note) => {
          const { kind, text } = splitNote(note);
          return (
            <li key={note} className={`note ${kind}`} title={text}>
              {kind === "waits" ? <ArrowRightIcon aria-hidden="true" /> : null}
              <span className="note-text">{kind === "next" ? <><b>next:</b> {text}</> : text}</span>
            </li>
          );
        })}
        {claims.map((claim) => (
          <li key={`${claim.task}:${claim.agent}`} className="note claim" title={`claimed since ${claim.since}`}>
            <span className="chip chip-accent">{claim.agent}</span>
            <span className="note-text">holds {claim.task} ({claim.track})</span>
          </li>
        ))}
      </ul>
      <div className="milestone-done">
        <Progress share={row.share} label={`${row.id} ${row.name}`} />
        <span className="count">{row.count === null ? (row.built === undefined ? "" : "built") : `${row.count[0]}/${row.count[1]}`}</span>
      </div>
    </li>
  );
}

function ToDone({ text, onOpenDone }: { text: string; onOpenDone: (() => void) | undefined }) {
  return <button type="button" className="to-done small" onClick={onOpenDone}>{text}</button>;
}

function Stage({ stage, claims, onOpenDone }: { stage: OpenStage; claims: LiveClaim[]; onOpenDone: (() => void) | undefined }) {
  return (
    <div className="stage">
      <div className="stage-head">
        <h3>Stage {stage.id}<span className="name">{stage.name}</span></h3>
        <span className={`chip mono chip-${tone(stage.share)}`}>{percent(stage.share)}</span>
      </div>
      {stage.goal === undefined ? null : <p className="small stage-goal">{stage.goal}</p>}
      {stage.reopened ? <p className="small stage-closed">closed {stage.closedAt?.slice(0, 10) ?? ""}, and it has open work again</p> : null}
      {stage.allFinished ? <p className="small stage-finished">{ALL_FINISHED}</p> : null}
      {stage.rows.length === 0 ? null : <ul>{stage.rows.map((row) => <Milestone key={row.id} row={row} claims={claims.filter((c) => c.milestone === row.id)} />)}</ul>}
      {stage.finished === 0 ? null : <ToDone text={finishedLine(stage.finished)} onOpenDone={onOpenDone} />}
    </div>
  );
}

function NothingOpen({ onOpenDone }: { onOpenDone: (() => void) | undefined }) {
  return (
    <div className="empty">
      <InfoCircledIcon aria-hidden="true" />
      <p><b>Nothing is open.</b> Every phase is closed and every milestone is finished; what was done is in Done. <button type="button" className="to-done" onClick={onOpenDone}>Open Done</button></p>
    </div>
  );
}

export function Board({ status, claims = [], onOpenDone }: BoardProps) {
  const board = openBoard(status);
  const nothingOpen = board.stages.length === 0 && board.closedOff > 0;
  return (
    <section className="board" aria-label="Board">
      {nothingOpen ? <NothingOpen onOpenDone={onOpenDone} /> : board.stages.map((stage) => <Stage key={stage.id} stage={stage} claims={claims} onOpenDone={onOpenDone} />)}
      {board.closedOff === 0 || nothingOpen ? null : <ToDone text={closedLine(board.closedOff)} onOpenDone={onOpenDone} />}
    </section>
  );
}
