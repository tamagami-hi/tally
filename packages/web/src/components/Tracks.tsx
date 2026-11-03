import { statusClass } from "../format.ts";
import type { LiveState, StatusData, TrackRow } from "../types.ts";

function Changes({ track }: { track: TrackRow }) {
  const adds = track.files.reduce((n, f) => n + (Number(f.add) || 0), 0);
  const dels = track.files.reduce((n, f) => n + (Number(f.del) || 0), 0);
  return (
    <details className="changes" open={track.files.length <= 12}>
      <summary>
        <span>CHANGES</span>
        <span className="mono"><span className="add">+{adds}</span> <span className="del">-{dels}</span></span>
      </summary>
      <ul>
        {track.files.map((file) => (
          <li key={file.path} className="file">
            <span className={`status ${statusClass(file.status)}`}>{file.status === "??" ? "?" : file.status}</span>
            <span className="truncate" title={file.path}>{file.path}</span>
            <span className="diff">{file.add === "" ? "" : <><span className="add">+{file.add}</span> <span className="del">-{file.del}</span></>}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Track({ track, state }: { track: TrackRow; state: LiveState | undefined }) {
  const sessions = state?.sessions.filter((s) => s.track === track.track) ?? [];
  const locks = state?.locks.filter((l) => l.track === track.track) ?? [];
  const condition = !track.worktree ? <span className="chip chip-idle">no worktree</span> : track.dirty === 0 ? <span className="chip chip-done">clean</span> : <span className="chip chip-active">{track.dirty} uncommitted</span>;
  return (
    <li className={`track ${track.isMain ? "main" : ""}`}>
      <div className="track-top">
        <span className={`chip mono ${track.isMain ? "chip-accent" : "chip-remote"}`}>{track.branch}</span>
        {condition}
      </div>
      <div className="path">{track.isMain ? "the operator's checkout" : track.path || "no worktree"}</div>
      {sessions.length + locks.length > 0 ? (
        <div className="chips">
          {sessions.map((s) => <span key={s.id} className="chip chip-accent">{s.agent} working</span>)}
          {locks.map((l) => <span key={l.name} className="chip chip-active" title={l.note}>holds {l.name}</span>)}
        </div>
      ) : null}
      <div className="commit truncate" title={track.subject}><span className="hash">{track.head}</span>{track.subject}</div>
      <dl className="kv">
        <dt>Last commit</dt><dd className="v">{track.when}</dd>
        {track.isMain ? null : <><dt>Ahead / behind main</dt><dd className="v">+{track.ahead} / -{track.behind}</dd></>}
      </dl>
      {track.worktree && track.dirty === 0 ? <div className="clean-line">✓ Nothing uncommitted</div> : null}
      {track.dirty > 0 ? <Changes track={track} /> : null}
    </li>
  );
}

export function Tracks({ status, state }: { status: StatusData; state?: LiveState | undefined }) {
  const dirty = status.tracks.filter((t) => t.dirty > 0).length;
  return (
    <section className="tracks" aria-label="Tracks" data-summary={`${status.tracks.length} · ${dirty} with uncommitted work`}>
      {status.tracks.map((track) => <Track key={track.branch} track={track} state={state} />)}
    </section>
  );
}

export const tracksSummary = (status: StatusData): string => `${status.tracks.length} · ${status.tracks.filter((t) => t.dirty > 0).length} with uncommitted work`;
