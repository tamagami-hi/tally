import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { here, type Place } from "./place.ts";
import type { DocsIndex, DoneWork, EndedSessions, EvidenceIndex, Layout, Live, Snapshot } from "./types.ts";

export const SNAPSHOT_KEY = ["snapshot"];

async function fetchSnapshot(api: string): Promise<Snapshot> {
  const response = await fetch(`${api}/snapshot`);
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as Snapshot;
}

export function useSnapshot(place: Place, enabled: boolean): { snapshot: Snapshot | undefined; error: Error | null; live: Live; retry: () => void } {
  const client = useQueryClient();
  const { api, events } = place;
  const query = useQuery({ queryKey: [...SNAPSHOT_KEY, api], queryFn: () => fetchSnapshot(api), staleTime: Infinity, retry: 1, enabled });
  const [live, setLive] = useState<Live>("reconnecting");
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return undefined;
    const source = new EventSource(events);
    source.addEventListener("open", () => setLive("connected"));
    source.addEventListener("error", () => setLive(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting"));
    source.addEventListener("snapshot", (event) => {
      client.setQueryData([...SNAPSHOT_KEY, api], JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      setLive("connected");
    });
    return () => source.close();
  }, [client, api, events, enabled]);
  return { snapshot: query.data, error: query.error, live, retry: () => void query.refetch() };
}

async function fetchEvidence(api: string): Promise<EvidenceIndex> {
  const response = await fetch(`${api}/evidence`);
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as EvidenceIndex;
}

export function useEvidence(version: string | undefined, api: string): EvidenceIndex | undefined {
  const query = useQuery({ queryKey: ["evidence", api, version], queryFn: () => fetchEvidence(api), staleTime: Infinity, enabled: version !== undefined, placeholderData: keepPreviousData });
  return query.data;
}

async function fetchDocs(api: string): Promise<DocsIndex> {
  const response = await fetch(`${api}/docs`);
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as DocsIndex;
}

export function useDocs(version: string | undefined, api: string): DocsIndex | undefined {
  const query = useQuery({ queryKey: ["docs", api, version], queryFn: () => fetchDocs(api), staleTime: Infinity, enabled: version !== undefined, placeholderData: keepPreviousData });
  return query.data;
}

export interface Loaded<T> {
  data: T | undefined;
  failed: string | undefined;
  loading: boolean;
  retry: () => void;
}

async function refusalOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? `: ${body.error}` : "";
  } catch {
    return "";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the server answered ${response.status}${await refusalOf(response)}`);
  return (await response.json()) as T;
}

function useLoaded<T>(url: string | null, version: string): Loaded<T> {
  const [held, setHeld] = useState<{ url: string; data: T } | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (url === null) return undefined;
    let current = true;
    fetchJson<T>(url).then(
      (data) => {
        if (!current) return;
        setHeld({ url, data });
        setFailed(undefined);
      },
      (error: unknown) => {
        if (current) setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      current = false;
    };
  }, [url, version, attempt]);
  const retry = useCallback(() => {
    setFailed(undefined);
    setAttempt((count) => count + 1);
  }, []);
  return { data: held?.data, failed, loading: url !== null && held?.url !== url && failed === undefined, retry };
}

export const useDone = (version: string): Loaded<DoneWork> => useLoaded<DoneWork>(`${here().api}/done`, version);

export const useEndedSessions = (version: string, shown: boolean, limit: number): Loaded<EndedSessions> =>
  useLoaded<EndedSessions>(shown ? `${here().api}/done/sessions?limit=${limit}` : null, version);

const PORTRAIT = "(orientation: portrait), (max-width: 1023px)";

export function useLayout(): Layout {
  const matches = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PORTRAIT).matches;
  const [layout, setLayout] = useState<Layout>(() => (matches() ? "portrait" : "landscape"));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(PORTRAIT);
    const update = (): void => setLayout(media.matches ? "portrait" : "landscape");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return layout;
}

export type Scheme = "light" | "dark";

function storedScheme(): Scheme | undefined {
  try {
    const value = window.localStorage.getItem("tally.scheme");
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function useScheme(): [Scheme, () => void] {
  const system = (): Scheme => (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [scheme, setScheme] = useState<Scheme>(() => storedScheme() ?? system());
  const toggle = (): void => {
    const next: Scheme = scheme === "dark" ? "light" : "dark";
    setScheme(next);
    try {
      window.localStorage.setItem("tally.scheme", next);
    } catch {
      return;
    }
  };
  return [scheme, toggle];
}
