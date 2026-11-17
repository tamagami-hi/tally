import { TallyError } from "@tally/core";
import { readStamp, sourceVersion, type BuildPlace, type BuildStamp } from "../build-stamp.ts";
import type { IO } from "../io.ts";

const ASKING_MS = 3_000;
const REBUILD = "npm run build rebuilds it";

interface ServiceSaid {
  line: string;
  version?: string;
}

const healthOf = (body: unknown): string | undefined => {
  const version = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["version"] : undefined;
  return typeof version === "string" && version !== "" ? version : undefined;
};

async function askService(url: string, source: string): Promise<ServiceSaid> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(ASKING_MS) });
    const version = healthOf(await response.json().catch(() => null));
    if (version === undefined) return { line: `service  unknown: ${url} answers, but not with its version, so it is older than ${source}` };
    return { line: `service  ${version} at ${url}`, version };
  } catch {
    return { line: `service  unknown: nothing answers at ${url}` };
  }
}

function buildLine(place: BuildPlace, stamp: BuildStamp | undefined): string {
  if (place.dist === null) return "build    none: this runs from source";
  if (stamp === undefined) return `build    unknown: no stamp in ${place.dist}`;
  return `build    ${stamp.version}, built ${stamp.builtAt}`;
}

function buildDiffers(place: BuildPlace, stamp: BuildStamp | undefined, source: string): string | undefined {
  if (place.dist === null) return undefined;
  if (stamp === undefined) return `the build's version is unknown: ${REBUILD}`;
  return stamp.version === source ? undefined : `the build is ${stamp.version} and the source ${source}: ${REBUILD}`;
}

export async function versionCommand(args: readonly string[], io: IO, place: BuildPlace): Promise<number> {
  if (args.length > 0) throw new TallyError(`tally version takes no arguments, not ${args.join(" ")}`, 2);
  const source = await sourceVersion(place);
  const stamp = place.dist === null ? undefined : await readStamp(place.dist);
  const url = io.env["TALLY_URL"];
  const service = url === undefined || url === "" ? undefined : await askService(url.replace(/\/+$/, ""), source);
  const build = buildDiffers(place, stamp, source);
  const serviceDiffers = service?.version === undefined || service.version === source ? undefined : `the service is ${service.version} and the source ${source}`;
  const differ = [build, serviceDiffers].filter((line): line is string => line !== undefined);
  io.out(`source   ${source}`);
  io.out(buildLine(place, stamp));
  if (service !== undefined) io.out(service.line);
  io.out(differ.length === 0 ? "they agree" : differ.join("; "));
  return build === undefined ? 0 : 1;
}
