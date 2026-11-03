#!/usr/bin/env node
import { processIO } from "./io.ts";
import { run } from "./run.ts";

process.exitCode = await run(process.argv.slice(2), processIO);
