import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AddRepo } from "./components/AddRepo.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { FOLDERS_KEY, REPOS_KEY, operate, useCollapsed, useFolders } from "./repos.ts";
import type { Layout, RepoIndex } from "./types.ts";

interface FrameProps {
  index: RepoIndex;
  current: string | null;
  layout: Layout;
  children: ReactNode;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function Frame({ index, current, layout, children }: FrameProps) {
  const client = useQueryClient();
  const [collapsed, toggle] = useCollapsed(layout === "portrait");
  const [adding, setAdding] = useState(false);
  const [dir, setDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const folders = useFolders(dir, adding);

  const act = async (work: () => Promise<void>, after: () => void): Promise<void> => {
    setBusy(true);
    setRefused(null);
    try {
      await work();
      await client.invalidateQueries({ queryKey: REPOS_KEY });
      await client.invalidateQueries({ queryKey: FOLDERS_KEY });
      after();
    } catch (error: unknown) {
      setRefused(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = (name: string): void => void act(() => operate("DELETE", `/api/repos/${name}`), () => {
    if (name === current) window.location.assign("/");
  });
  const makeDefault = (name: string): void => void act(() => operate("POST", `/api/repos/${name}/default`, {}), () => undefined);
  const add = (path: string, name: string): void => void act(() => operate("POST", "/api/repos", { root: path, ...(name === "" ? {} : { name }) }), () => setAdding(false));
  const close = (): void => {
    setAdding(false);
    setRefused(null);
  };

  return (
    <div className={`frame ${layout}`}>
      <Sidebar index={index} current={current} collapsed={collapsed} onToggle={toggle} onAdd={() => setAdding(true)} onRemove={remove} onDefault={makeDefault} />
      <div className="frame-main">
        {refused !== null && !adding ? <p className="problems" role="alert">{refused}</p> : null}
        {adding ? <AddRepo listing={folders.listing} error={refused ?? folders.error?.message ?? null} busy={busy} onOpen={setDir} onAdd={add} onClose={close} /> : null}
        {children}
      </div>
    </div>
  );
}
