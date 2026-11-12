import { stat } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { CONFIG_FILE, RECORDS_DIR, reopenRepo, type Repo } from "../store/records.ts";
import { tracksPath } from "../tracks/file.ts";

export async function fileStamp(path: string): Promise<string> {
  try {
    const { mtimeNs, ctimeNs, size, ino } = await stat(path, { bigint: true });
    return `${mtimeNs}:${ctimeNs}:${size}:${ino}`;
  } catch (error: unknown) {
    return `unreadable:${(error as NodeJS.ErrnoException).code ?? "unknown"}`;
  }
}

export async function recordsStamp(root: string, recordsDir = join(root, RECORDS_DIR)): Promise<string> {
  return `${await fileStamp(join(root, RECORDS_DIR, CONFIG_FILE))} ${await fileStamp(tracksPath(recordsDir))}`;
}

export class LiveRepo {
  private repo: Repo;
  private stamp: Promise<string>;
  private trouble: string | undefined;

  constructor(repo: Repo) {
    this.repo = repo;
    this.stamp = recordsStamp(repo.root, repo.recordsDir);
  }

  get problem(): string | undefined {
    return this.trouble;
  }

  async current(): Promise<Repo> {
    const seen = await this.stamp;
    const now = await recordsStamp(this.repo.root, this.repo.recordsDir);
    if (now === seen) return this.repo;
    try {
      this.repo = await reopenRepo(this.repo);
      this.trouble = undefined;
    } catch (error: unknown) {
      if (!(error instanceof TallyError)) throw error;
      this.trouble = messageOf(error);
    }
    this.stamp = Promise.resolve(now);
    return this.repo;
  }
}
