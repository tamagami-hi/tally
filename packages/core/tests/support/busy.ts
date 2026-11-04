import lockfile from "proper-lockfile";
import { afterEach, vi } from "vitest";

export function busyLock(suffix: string): void {
  const real = lockfile.lock.bind(lockfile);
  vi.spyOn(lockfile, "lock").mockImplementation((file, options) =>
    file.endsWith(suffix) ? Promise.reject(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED" })) : real(file, options));
}

afterEach(() => {
  vi.restoreAllMocks();
});
