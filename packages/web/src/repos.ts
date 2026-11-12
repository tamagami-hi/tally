import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FolderListing, RepoIndex } from "./types.ts";

export const REPOS_KEY = ["repos"];
export const FOLDERS_KEY = ["folders"];

const REFRESH_MS = 3000;
const NOT_FOUND = 404;
const OPERATOR = { "content-type": "application/json", "x-tally-operator": "1" };
const STORED = "tally.sidebar";

async function refusal(response: Response): Promise<Error> {
  const answer = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(answer?.error ?? `the server answered ${response.status}`);
}

async function fetchIndex(): Promise<RepoIndex | null> {
  const response = await fetch("/api/repos");
  if (response.status === NOT_FOUND) return null;
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as RepoIndex;
}

export function useRepos(): RepoIndex | null | undefined {
  const query = useQuery({ queryKey: REPOS_KEY, queryFn: fetchIndex, refetchInterval: REFRESH_MS, retry: 1 });
  return query.isError ? null : query.data;
}

async function fetchFolders(dir: string | null): Promise<FolderListing> {
  const response = await fetch(dir === null ? "/api/fs" : `/api/fs?dir=${encodeURIComponent(dir)}`);
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as FolderListing;
}

export function useFolders(dir: string | null, enabled: boolean): { listing: FolderListing | undefined; error: Error | null } {
  const query = useQuery({ queryKey: [...FOLDERS_KEY, dir], queryFn: () => fetchFolders(dir), enabled, retry: false });
  return { listing: query.data, error: query.error };
}

export async function operate(method: "POST" | "DELETE", path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, { method, headers: OPERATOR, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw await refusal(response);
}

function stored(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(STORED);
    return value === null ? undefined : value === "collapsed";
  } catch {
    return undefined;
  }
}

export function useCollapsed(byDefault: boolean): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => stored() ?? byDefault);
  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORED, next ? "collapsed" : "open");
    } catch {
      return;
    }
  };
  return [collapsed, toggle];
}
