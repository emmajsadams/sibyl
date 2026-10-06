import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BALANCE } from "../types";
import { generateRandomConfig } from "../training/squads";
import { createGame, createUnit, advanceRound } from "../engine/game";
import { evidence, journalFailure } from "./runner";
import type { Manifest } from "./runner";
import { bounded, safeEnv } from "./process";
import { CLASSES, hash, isClean, WHITELIST } from "./core";
import type { Checkpoint, Result } from "./core";

const cwd = process.cwd();
test("subprocess timeout kills and waits without launching a provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-process-test-"));
  try {
    const start = Date.now();
    const result = await bounded(
      [process.execPath, "-e", "setTimeout(()=>{}, 60000)"],
      join(dir, "log"),
      50,
      cwd,
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("worker and designer child environments never inherit API keys", () => {
  const original = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = "test-only";
    expect(safeEnv().TYPESAFE_API_KEY).toBeUndefined();
  } finally {
    if (original === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = original;
  }
});
test("no-flag runner is inert and creates no experiment checkpoint", () => {
  const before = existsSync("experiments/jev-balance-20261006/raw/checkpoint.json");
  const result = Bun.spawnSync([process.execPath, "run", "src/balance/runner.ts"], {
    env: safeEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Not launched");
  expect(existsSync("experiments/jev-balance-20261006/raw/checkpoint.json")).toBe(before);
});
test("interrupted journals count unfinished provider requests and cannot be clean", () => {
  const config = generateRandomConfig();
  const req = {
    config,
    balance: structuredClone(BALANCE),
    codeCommit: "fixture-only",
    cycleHash: "fixture-only",
    attempt: 1,
  };
  const r = journalFailure(
    req,
    "timeout",
    [
      JSON.stringify({ type: "provider_start", id: 1 }),
      JSON.stringify({ type: "provider_response", id: 1 }),
      JSON.stringify({ type: "provider_start", id: 2 }),
      '{"type":',
    ].join("\n"),
  );
  expect(r.decisions).toBe(2);
  expect(r.failedDecisions).toBe(1);
  expect(r.failure).toBe("timeout");
  expect(isClean(r)).toBe(false);
  expect(r.requestHash).toBe(hash(req));
});
test("designer evidence refuses 49 clean games, failed replacements and duplicate slots", () => {
  // In-memory engine terminal fixture only; never written to the experiment directory.
  const state = createGame();
  state.units = [
    createUnit("p", "p", "sentinel", "player", { x: 0, y: 0 }, "wait"),
    createUnit("o", "o", "sentinel", "opponent", { x: 5, y: 5 }, "wait"),
  ];
  state.round = 20;
  advanceRound(state);
  const result: Result = {
    clean: true,
    winner: state.winner ?? "draw",
    reason: state.terminalReason!,
    rounds: 20,
    decisions: 2,
    failedDecisions: 0,
    failure: null,
    codeCommit: "fixture-only",
    requestHash: "fixture-only",
  };
  const s: Checkpoint = {
    version: 1,
    cycle: 1,
    startedAt: Date.now(),
    attempts: [],
    manifestHashes: {},
    pending: null,
    consecutiveFailures: 0,
    halted: null,
    complete: false,
  };
  const m: Manifest = {
    cycle: 1,
    codeCommit: "fixture-only",
    sourceHash: "fixture-only",
    rules: {},
    balance: structuredClone(BALANCE),
    whitelist: WHITELIST,
    discovery: Array.from({ length: 25 }, generateRandomConfig),
    evaluation: Object.fromEntries(
      CLASSES.map((c) => [c, []]),
    ) as unknown as Manifest["evaluation"],
  };
  s.attempts = Array.from({ length: 49 }, (_, i) => ({
    id: i + 1,
    cycle: 1,
    stage: "discovery",
    slot: i,
    retry: 0,
    result,
  }));
  expect(() => evidence(s, m)).toThrow();
  s.attempts.push({
    id: 50,
    cycle: 1,
    stage: "discovery",
    slot: 49,
    retry: 0,
    result: { ...result, failedDecisions: 1 },
  });
  expect(() => evidence(s, m)).toThrow();
  s.attempts[49]!.result = result;
  expect(evidence(s, m).cleanDiscovery).toBe(50);
  s.attempts[49]!.slot = 0;
  expect(() => evidence(s, m)).toThrow();
});
test("PTY helper passes read-only schema flags and strips Jev key using offline executable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-pty-test-"));
  try {
    const { writeFileSync } = await import("node:fs");
    const executable = join(dir, "inspect.py");
    writeFileSync(
      executable,
      '#!/usr/bin/env python3\nimport os,sys,json\nassert os.isatty(0) and os.isatty(1)\nassert "TYPESAFE_API_KEY" not in os.environ\nassert sys.argv[1:4] == ["exec","--sandbox","read-only"]\nout=sys.argv[sys.argv.index("--output-last-message")+1]\nwith open(out,"w") as f: json.dump({"offline_transport_verified":True},f)\n',
      { mode: 0o700 },
    );
    writeFileSync(join(dir, "prompt.txt"), "offline transport only");
    writeFileSync(join(dir, "schema.json"), "{}");
    const output = join(dir, "response.json");
    const r = await bounded(
      [
        "python3",
        join(cwd, "scripts/jev-designer-pty.py"),
        executable,
        dir,
        join(dir, "schema.json"),
        output,
        join(dir, "prompt.txt"),
        "5",
      ],
      join(dir, "log"),
      10000,
      cwd,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).offline_transport_verified).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
