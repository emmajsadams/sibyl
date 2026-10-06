#!/usr/bin/env python3
"""PTY transport only; no shell interpolation, credentials, retries or proposals."""
import errno
import os
import pty
import select
import signal
import subprocess
import sys
import time


def main():
    executable, root, schema, output, prompt_path, seconds = sys.argv[1:]
    env = {k: v for k, v in os.environ.items() if k not in ("TYPESAFE_API_KEY", "OPENAI_API_KEY", "OPENAI_ACCESS_TOKEN")}
    # Keep existing Codex login, but do not load user tools/hooks or workspace instructions.
    with open(prompt_path, encoding="utf8") as f:
        prompt = f.read()
    master, slave = pty.openpty()
    process = subprocess.Popen([
        executable, "exec", "--sandbox", "read-only", "--ignore-user-config",
        "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--color", "never",
        "-c", "project_doc_max_bytes=0", "-C", root,
        "--output-schema", schema, "--output-last-message", output, prompt,
    ], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
    os.close(slave)
    def stop(_signum, _frame):
        raise SystemExit(130)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    deadline = time.monotonic() + float(seconds)
    try:
        while True:
            if time.monotonic() >= deadline:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return 124
            readable, _, _ = select.select([master], [], [], 0.2)
            if readable:
                try:
                    data = os.read(master, 65536)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                # Logs go only to the ignored private designer directory.
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            if process.poll() is not None and not readable:
                break
        return process.wait()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        os.close(master)


if __name__ == "__main__":
    sys.exit(main())
