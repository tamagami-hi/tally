export interface IO {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns: number;
  isTTY: boolean;
}

function quietWhenClosed(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

quietWhenClosed(process.stdout);
quietWhenClosed(process.stderr);

export const processIO: IO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  cwd: process.cwd(),
  env: process.env,
  columns: process.stdout.columns ?? 120,
  isTTY: process.stdout.isTTY === true,
};
