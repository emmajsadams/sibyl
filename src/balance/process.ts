/** Shared subprocess boundary: no shell, no credential inheritance, bounded lifetime. */
export function safeEnv() {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
    "CODEX_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
  );
}
export async function bounded(
  args: string[],
  log: string,
  timeoutMs: number,
  cwd: string,
  workerEnv: { TYPESAFE_API_KEY: string } | undefined = undefined,
) {
  const file = Bun.file(log);
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...safeEnv(), ...workerEnv },
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
