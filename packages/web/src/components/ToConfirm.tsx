import { useState } from "react";
import { here } from "../place.ts";
import { operate } from "../repos.ts";
import type { ToConfirmRow } from "../types.ts";

const LOCALE = "en-GB";

type Mark = "confirm" | "dispute";

const when = (time: string): string => new Date(time).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });

const markPath = (row: ToConfirmRow, mark: Mark): string => `${here().api}/operator/decisions/${encodeURIComponent(row.group)}/${encodeURIComponent(row.id)}/${mark}`;

export function ToConfirm({ decisions }: { decisions: ToConfirmRow[] }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  if (decisions.length === 0) return null;
  const act = (row: ToConfirmRow, mark: Mark): void => {
    setBusy(true);
    setFailed(undefined);
    operate("POST", markPath(row, mark), {}).then(
      () => setBusy(false),
      (error: unknown) => {
        setBusy(false);
        setFailed(error instanceof Error ? error.message : String(error));
      },
    );
  };
  return (
    <section className="to-confirm" aria-label="Decisions to confirm">
      <strong>Decisions to confirm</strong>
      {failed === undefined ? null : <div role="alert">{`That did not go through: ${failed}.`}</div>}
      <ul>
        {decisions.map((row) => (
          <li key={`${row.group}/${row.id}`}>
            <div><span className="mono">{`${row.group} ${row.id}`}</span>{row.disputed === true ? " · marked not yours" : ""}</div>
            <p>{row.text}</p>
            <blockquote className="small">{`“${row.said}”`}</blockquote>
            <p className="faint small">{`recorded by ${row.via.agent} on ${row.via.track}${row.on === undefined ? "" : `, ${when(row.on)}`}`}</p>
            <div className="to-confirm-actions">
              <button type="button" className="button" disabled={busy} onClick={() => act(row, "confirm")}>Confirm</button>
              <button type="button" className="button" disabled={busy} onClick={() => act(row, "dispute")}>Not mine</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
