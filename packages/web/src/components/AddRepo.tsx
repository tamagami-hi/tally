import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Folder, FolderListing } from "../types.ts";

export interface AddRepoProps {
  listing: FolderListing | undefined;
  error: string | null;
  busy: boolean;
  onOpen: (dir: string) => void;
  onAdd: (path: string, name: string) => void;
  onClose: () => void;
}

interface FolderRowProps {
  folder: Folder;
  busy: boolean;
  onOpen: (dir: string) => void;
  onAdd: (path: string) => void;
}

function FolderRow({ folder, busy, onOpen, onAdd }: FolderRowProps) {
  if (!folder.isRepo) {
    return (
      <li className="folder">
        <button type="button" className="link" aria-label={`Open ${folder.name}`} onClick={() => onOpen(folder.path)}>{folder.name}/</button>
      </li>
    );
  }
  return (
    <li className="folder repo-folder">
      <span className="truncate">{folder.name}</span>
      {folder.hasRecords ? null : <span className="chip chip-line">tally will start its records</span>}
      {folder.listed === null ? (
        <button type="button" className="button" aria-label={`Add ${folder.name}`} disabled={busy} onClick={() => onAdd(folder.path)}>Add</button>
      ) : (
        <span className="chip chip-idle">listed as {folder.listed}</span>
      )}
    </li>
  );
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), a[href]";

function useHeldFocus(onClose: () => void) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab" || panel.current === null) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;
      const leaving = event.shiftKey ? document.activeElement === first || document.activeElement === panel.current : document.activeElement === last;
      const outside = !panel.current.contains(document.activeElement);
      if (!leaving && !outside) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return panel;
}

export function AddRepo({ listing, error, busy, onOpen, onAdd, onClose }: AddRepoProps) {
  const [name, setName] = useState("");
  const panel = useHeldFocus(onClose);
  const closeFromBehind = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };
  return (
    <div className="overlay" onMouseDown={closeFromBehind}>
      <section ref={panel} className="add-repo panel" role="dialog" aria-modal="true" aria-label="Add a repository" tabIndex={-1}>
        <div className="panel-head">
          <h2>Add a repository</h2>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </div>
        <div className="panel-body">
          {error === null ? null : <p className="problems" role="alert">{error}</p>}
          <label className="field small">
            <span>Name (optional)</span>
            <input type="text" value={name} placeholder="the folder's name" onChange={(event) => setName(event.target.value)} />
          </label>
          {listing === undefined ? (
            <p className="muted">Reading the folder…</p>
          ) : (
            <>
              <p className="mono muted">{listing.dir}</p>
              {listing.parent === null ? null : <button type="button" className="link" aria-label={`Up to ${listing.parent}`} onClick={() => onOpen(listing.parent ?? listing.dir)}>../</button>}
              {listing.folders.length === 0 ? <p className="muted small">No folders here.</p> : null}
              <ul className="folders">
                {listing.folders.map((folder) => (
                  <FolderRow key={folder.path} folder={folder} busy={busy} onOpen={onOpen} onAdd={(path) => onAdd(path, name.trim())} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
