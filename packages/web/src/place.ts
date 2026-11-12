export interface Place {
  repo: string | null;
  api: string;
  events: string;
}

const BOARD = /^\/r\/([a-z0-9][a-z0-9_-]*)(?:\/|$)/;

export function placeOf(pathname: string): Place {
  const name = BOARD.exec(pathname)?.[1];
  if (name === undefined) return { repo: null, api: "/api", events: "/events" };
  return { repo: name, api: `/api/r/${name}`, events: `/api/r/${name}/events` };
}

export function here(): Place {
  return placeOf(typeof window === "undefined" ? "/" : window.location.pathname);
}
