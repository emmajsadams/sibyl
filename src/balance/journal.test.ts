import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoveredJournal } from "./runner";
import { BALANCE } from "../types";
import { generateRandomConfig } from "../training/squads";

test("journal recovery streams oversized game text and preserves failure counts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-journal-"));
  try {
    const request = {
      config: generateRandomConfig(),
      balance: structuredClone(BALANCE),
      codeCommit: "fixture",
      cycleHash: "fixture",
      attempt: 1,
    };
    writeFileSync(
      join(dir, "events.jsonl"),
      [
        JSON.stringify({ type: "provider_start", id: 1, round: 20, request: "x".repeat(200000) }),
        JSON.stringify({ type: "provider_response", id: 1 }),
        JSON.stringify({ type: "match_failure", failure: "decision_error", failedDecisions: 1 }),
        '{"type":"provider_start"',
      ].join("\n"),
    );
    const result = await recoveredJournal(request, "worker_error", dir);
    expect(result.decisions).toBe(1);
    expect(result.rounds).toBe(20);
    expect(result.failedDecisions).toBe(1);
    expect(result.failure).toBe("decision_error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
