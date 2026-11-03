import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { EvidenceIndex, Layout, Live, Snapshot } from "./types.ts";

export const SNAPSHOT_KEY = ["snapshot"];

async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch("/api/snapshot");
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as Snapshot;
}

export function useSnapshot(): { snapshot: Snapshot | undefined; error: Error | null; live: Live; retry: () => void } {
  const client = useQueryClient();
  const query = useQuery({ queryKey: SNAPSHOT_KEY, queryFn: fetchSnapshot, staleTime: Infinity, retry: 1 });
  const [live, setLive] = useState<Live>("reconnecting");
  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource("/events");
    source.addEventListener("open", () => setLive("connected"));
    source.addEventListener("error", () => setLive(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting"));
    source.addEventListener("snapshot", (event) => {
      client.setQueryData(SNAPSHOT_KEY, JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      setLive("connected");
    });
    return () => source.close();
  }, [client]);
  return { snapshot: query.data, error: query.error, live, retry: () => void query.refetch() };
}

async function fetchEvidence(): Promise<EvidenceIndex> {
  const response = await fetch("/api/evidence");
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return (await response.json()) as EvidenceIndex;
}

export function useEvidence(version: string | undefined): EvidenceIndex | undefined {
  const query = useQuery({ queryKey: ["evidence", version], queryFn: fetchEvidence, staleTime: Infinity, enabled: version !== undefined, placeholderData: keepPreviousData });
  return query.data;
}

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
