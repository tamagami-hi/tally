import { buildPlaceOf, writeStamp } from "./build-stamp.ts";

const stamp = await writeStamp(buildPlaceOf(import.meta.url), new Date());
process.stdout.write(`tally: build stamped ${stamp.version} at ${stamp.builtAt}\n`);
