import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TallyError, checksFingerprint, readChecks, renderChecks, setChecks, type Repo } from "@tally/core";
import { parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function checksCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "get": {
      const record = await readChecks(repo);
      if (record === null) throw new TallyError("no checks.json yet; import one with tally import checks");
      io.out(JSON.stringify(record, null, 2));
      return 0;
    }
    case "render": {
      const record = await readChecks(repo);
      if (record === null) throw new TallyError("no checks.json yet; import one with tally import checks");
      io.out(renderChecks(record).replace(/\n$/, ""));
      return 0;
    }
    case "fingerprint": {
      const result = await checksFingerprint(repo);
      io.out(`record ${result.record ?? "none"}; main ${result.main || "none"}; ${result.stands ? "the record stands" : "the record is stale"}`);
      return result.stands ? 0 : 1;
    }
    case "set": {
      const parsed = parse(rest, { file: { type: "string" } });
      const file = text(parsed, "file");
      if (file === undefined) throw new TallyError("checks set needs --file <checks.json>", 2);
      const done = await setChecks(repo, JSON.parse(await readFile(resolve(io.cwd, file), "utf8")) as unknown);
      io.out(`checks set at ${done.fingerprint}`);
      if (done.commit !== null) io.out(`records: ${done.commit}`);
      return 0;
    }
    default:
      throw new TallyError(`tally checks: unknown verb '${verb ?? ""}'; use get, render, fingerprint or set`, 2);
  }
}
