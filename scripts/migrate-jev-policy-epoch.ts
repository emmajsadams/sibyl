// One-time, explicitly user-authorized cycle-2 restart; never reads credentials.
import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicJSON, hash, isClean, LIMITS } from "../src/balance/core";
const root = join(import.meta.dir, "..");
const dest = join(root, "experiments/jev-balance-20261006");
const raw = join(dest, "raw");
const checkpoint = join(raw, "checkpoint.json");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
if (!process.argv.includes("--authorized-restart"))
  throw Error("Explicit authorization flag required");
if (existsSync(join(raw, "runner.lock")) || existsSync(join(dest, "policy-epoch-2.json")))
  throw Error("Active runner or migration already exists");
const s = read(checkpoint);
if (s.cycle !== 2 || s.pending || s.attempts.length !== 116 || s.complete)
  throw Error("Unexpected recovery checkpoint");
const old = structuredClone(s);
const historical = s.attempts.filter((a: any) => a.cycle === 2);
if (historical.filter((a: any) => a.result && isClean(a.result)).length !== 32)
  throw Error("Expected 32 archived clean games");
atomicJSON(join(raw, "checkpoint-before-epoch-2.json"), old);
const archive = join(dest, "archive-cycle-02-policy-1");
if (existsSync(archive)) throw Error("Archive already exists");
renameSync(join(dest, "cycle-02"), archive);
mkdirSync(join(dest, "cycle-02"));
for (const a of historical) {
  a.archived = true;
  a.policyEpoch = "policy-epoch-1";
}
delete s.manifestHashes["2"];
s.halted = null; // Authorized one-time recovery only; preserve failure streak and all cost.
s.policyEpoch = "policy-epoch-2";
const start = Date.now();
s.activeWindow = {
  startedAt: start,
  deadline: start + LIMITS.wallMs,
  authorization: "policy-epoch-2",
};
const beforeRules = read(join(archive, "manifest.json")).rules;
const afterRules = Object.fromEntries(
  Object.keys(beforeRules).map((p) => [p, readFileSync(join(root, p), "utf8")]),
);
atomicJSON(join(dest, "policy-epoch-2.json"), {
  version: 1,
  authorization:
    "User explicitly authorized 32 replacement extra games, homogeneous cycle2 restart, finite new 12-hour operational window, cycles2-10 only.",
  policyEpoch: s.policyEpoch,
  fromSourceHash: hash(beforeRules),
  toSourceHash: hash(afterRules),
  checkpointBeforeHash: hash(old),
  checkpointAfterHash: hash(s),
  originalStartedAt: s.startedAt,
  activeWindow: s.activeWindow,
  archive: "archive-cycle-02-policy-1",
  archivedAttempts: historical.map((a: any) => a.id),
  archivedCleanDiscovery: 32,
  preservedAttempts: old.attempts.length,
  preservedDecisions: old.attempts.reduce((n: number, a: any) => n + (a.result?.decisions ?? 0), 0),
  preservedConsecutiveFailures: s.consecutiveFailures,
  caps: LIMITS,
  evidence:
    "Cycle1 retained verbatim; old cycle2 excluded from slot satisfaction/designer evidence but counted in global attempts/cost. Fresh cycle2 manifest pins current full sources; no compatibility bypass. Original frozen cycle2 manifest retained verbatim in archive.",
});
atomicJSON(checkpoint, s);
console.log(
  JSON.stringify({
    epoch: s.policyEpoch,
    window: s.activeWindow,
    attempts: s.attempts.length,
    archivedClean: 32,
    sourceHash: hash(afterRules),
  }),
);
