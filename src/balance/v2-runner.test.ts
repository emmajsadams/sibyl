import { afterEach, test, expect } from "bun:test";
import { BALANCE } from "../types";
import { installBalance } from "./v2-worker";
const ORIGINAL_BALANCE = structuredClone(BALANCE);
afterEach(() => installBalance(ORIGINAL_BALANCE));
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { playMatch } from "./match";
import { QualityCollector } from "./v2-metrics";
import * as runner from "./v2-runner";
import { defaultObjective } from "./v2-core";

test("preflight is before checkpoint and three transient failures preserve bounded actual engine attempts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-failure-fixture-"));
  const config = {
    methodology: 2,
    kind: "balance",
    policyEpoch: "test-failures",
    discoveryPairs: 1,
    objective: defaultObjective(),
    maxAttempts: 110,
    wallMs: 60000,
    matchMs: 10000,
  };
  const deps = {
    codeCommit: () => "0".repeat(40),
    preflight: () => {
      throw Error("test-only missing credential");
    },
    match: async (request: any) => {
      const c = new QualityCollector("test-only-provider-failure");
      const result = await playMatch(
        request,
        new TypeSafeClient({
          apiKey: "test-only",
          fetch: async () => new Response("test-only", { status: 502 }),
        }),
        (e) => c.add(e),
      );
      return { result, quality: c.finish() };
    },
    design: async () => {
      throw Error("must not design");
    },
  };
  try {
    await expect(runner.runExperiment(dir, config, 5, deps)).rejects.toThrow("missing credential");
    expect(existsSync(join(dir, "raw/checkpoint.json"))).toBe(false);
    await expect(
      runner.runExperiment(dir, config, 5, { ...deps, preflight: () => {} }),
    ).rejects.toThrow("exhausted");
    const s = JSON.parse(readFileSync(join(dir, "raw/checkpoint.json"), "utf8"));
    expect(s.attempts).toHaveLength(3);
    expect(
      s.attempts.every((a: any) => !a.pending && a.outcome.result.failure === "http_502"),
    ).toBe(true);
    await expect(
      runner.runExperiment(dir, config, 5, { ...deps, preflight: () => {} }),
    ).rejects.toThrow("halted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline decision-stub end-to-end runs real engine, seals config, holds safely, resumes without replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-offline-"));
  let runs = 0;
  try {
    const config = {
      methodology: 2,
      kind: "balance",
      policyEpoch: "test-only-not-live",
      discoveryPairs: 1,
      objective: defaultObjective(),
      maxAttempts: 110,
      wallMs: 60000,
      matchMs: 10000,
    };
    const boundary = new TypeSafeClient({
      apiKey: "fixture-only",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)),
          opts = body.questions.action.criteria;
        const selected =
          Object.keys(opts).find((k) => JSON.parse(opts[k]).type === "wait") ??
          Object.keys(opts)[0];
        return Response.json({
          model: "offline-stub-NOT-live",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: {
            action: {
              type: "choice",
              choice: selected,
              confidence: 1,
              probabilities: Object.fromEntries(
                Object.keys(opts).map((k) => [k, k === selected ? 1 : 0]),
              ),
            },
          },
        });
      },
    });
    const dependencies = {
      codeCommit: () => "0".repeat(40),
      preflight: () => {},
      match: async (request: any) => {
        runs++;
        const c = new QualityCollector(`offline-${runs}`);
        const result = await playMatch(request, boundary, (e) => c.add(e));
        return { result, quality: c.finish() };
      },
      design: async (evidence: any) => ({
        decision: "hold",
        hypothesis: "Offline fixture no balance claim",
        rationale: "Tests only",
        evidenceIds: [evidence[0].evidenceId],
        expectedEffects: ["none"],
        manualReview: [],
        changes: [],
      }),
    };
    const result = await runner.runExperiment(dir, config, 2, dependencies);
    expect(result.phase).toBe("complete");
    expect(result.decision).toBe("inconclusive");
    expect(runs).toBe(2);
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "evaluation.json"), "utf8")).reason).toBe(
      "designer_hold",
    );
    await runner.runExperiment(dir, config, 2, dependencies);
    expect(runs).toBe(2);
    const manifest = JSON.parse(readFileSync(join(dir, "raw/manifest.json"), "utf8"));
    expect(manifest.methodology).toBe(2);
    await expect(
      runner.runExperiment(dir, { ...config, policyEpoch: "changed" }, 2, dependencies),
    ).rejects.toThrow("freeze");
    const holdoutDir = join(dir, "holdout-test-only");
    const evaluateConfig = {
      ...config,
      objective: { ...defaultObjective(), minBlocks: 4, maxBlocks: 4, looks: [4] },
    };
    const proposeDependencies = {
      ...dependencies,
      design: async (evidence: any) => ({
        decision: "propose",
        hypothesis: "Offline numeric smoke",
        rationale: "Test fixture not real results",
        evidenceIds: [evidence[0].evidenceId],
        expectedEffects: ["test gate path"],
        manualReview: [],
        changes: [{ path: "unitStats.medic.maxHp", value: 6 }],
      }),
    };
    const paused = await runner.runExperiment(holdoutDir, evaluateConfig, 3, proposeDependencies);
    expect(paused.phase).toBe("evaluation");
    expect(paused.blocks).toHaveLength(0);
    const final = await runner.runExperiment(holdoutDir, evaluateConfig, 20, proposeDependencies);
    expect(final.blocks).toHaveLength(4);
    expect(final.attempts).toHaveLength(18);
    expect(final.decision).toBe("inconclusive");
    expect(final.phase).toBe("complete");
    // Offline crash fixture: the final block persisted but decision write did not.
    const checkpoint = join(holdoutDir, "raw/checkpoint.json");
    const interrupted = JSON.parse(readFileSync(checkpoint, "utf8"));
    interrupted.phase = "evaluation";
    writeFileSync(checkpoint, JSON.stringify(interrupted));
    expect(
      (await runner.runExperiment(holdoutDir, evaluateConfig, 1, proposeDependencies)).phase,
    ).toBe("complete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
