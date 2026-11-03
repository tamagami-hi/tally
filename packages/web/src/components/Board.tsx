import { ArrowRightIcon, CheckIcon } from "@radix-ui/react-icons";
import { percent, splitNote, tone } from "../format.ts";
import type { LiveClaim, MilestoneRow, StatusData } from "../types.ts";
import { Progress } from "./Progress.tsx";

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

export function Board({ status, claims = [] }: { status: StatusData; claims?: LiveClaim[] }) {
  return (
    <section className="board" aria-label="Board">
      {status.stages.map((stage) => {
        const rows = status.rows.filter((row) => row.stage === stage.id);
        const share = status.stagePct[stage.id] ?? 0;
        return (
          <div key={stage.id} className="stage">
            <div className="stage-head">
              <h3>Stage {stage.id}<span className="name">{stage.name}</span></h3>
              <span className={`chip mono chip-${tone(share)}`}>{percent(share)}</span>
            </div>
            <ul>{rows.map((row) => <Milestone key={row.id} row={row} claims={claims.filter((c) => c.milestone === row.id)} />)}</ul>
          </div>
        );
      })}
    </section>
  );
}
