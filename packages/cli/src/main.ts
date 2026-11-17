#!/usr/bin/env node
import { buildPlaceOf } from "./build-stamp.ts";
import { entry } from "./entry.ts";
import { processIO } from "./io.ts";

process.exitCode = await entry(process.argv.slice(2), processIO, buildPlaceOf(import.meta.url));
