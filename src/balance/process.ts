/** Shared subprocess boundary: no shell, no credential inheritance, bounded lifetime. */
export function safeEnv() {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ACCESS_TOKEN;
  return env;
}
export async function bounded(args: string[], log: string, timeoutMs: number, cwd: string) {
  const file = Bun.file(log);
  const proc = Bun.spawn(args, {
    cwd,
    env: safeEnv(),
    stdout: file,
    stderr: file,
    stdin: "ignore",
  });
  let timedOut = false,
    interrupted = false;
  const stop = () => {
    interrupted = true;
    proc.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Worker has no children. PTY helper owns and kills the designer process group.
  const timer = setTimeout(
    () => {
      timedOut = true;
      proc.kill("SIGTERM");
    },
    Math.max(1, timeoutMs),
  );
  const hardTimer = setTimeout(() => proc.kill("SIGKILL"), Math.max(1, timeoutMs) + 3000);
  try {
    return { code: await proc.exited, timedOut, interrupted };
  } finally {
    clearTimeout(timer);
    clearTimeout(hardTimer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
