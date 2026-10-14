import { test, expect } from "bun:test";
import * as v2 from "./v2-core";
test("paired seeded bootstrap returns accepted rejected inconclusive and regression gates", () => {
  const objective = v2.defaultObjective();
  const block = (delta: number) => ({
    baseline: {
      pacing: 0.4,
      roles: 0.4,
      diversity: 0.4,
      imbalance: 0.4,
      stalemate: 0.2,
      steamroll: 0.2,
      errors: 0,
    },
    candidate: {
      pacing: 0.4 + delta,
      roles: 0.4 + delta,
      diversity: 0.4 + delta,
      imbalance: 0.4 + delta,
      stalemate: 0.2,
      steamroll: 0.2,
      errors: 0,
    },
  });
  const positive = Array.from({ length: 8 }, () => block(0.2));
  const a = v2.evaluateV2(positive, objective);
  expect(a.decision).toBe("accepted");
  expect(a).toEqual(v2.evaluateV2(positive, objective));
  expect(
    v2.evaluateV2(
      Array.from({ length: 8 }, () => block(-0.2)),
      objective,
    ).decision,
  ).toBe("rejected");
  expect(
    v2.evaluateV2(
      Array.from({ length: 8 }, () => block(0)),
      objective,
    ).decision,
  ).toBe("inconclusive");
  expect(v2.evaluateV2(positive.slice(0, 2), objective).decision).toBe("inconclusive");
  positive[0]!.candidate.errors = 1;
  expect(v2.evaluateV2(positive, objective).decision).toBe("rejected");
});

import { installBalance } from "./v2-worker";
test("v2 numeric ability loader reaches engine without permitting mechanics", () => {
  const original = structuredClone(BALANCE),
    candidate = structuredClone(BALANCE);
  candidate.abilities.patch.healAmount = 2;
  try {
    installBalance(candidate);
    expect(BALANCE.abilities.patch.healAmount).toBe(2);
    expect(() => installBalance({ ...candidate, maxRounds: 21 })).toThrow();
  } finally {
    installBalance(original);
  }
});
import { BALANCE } from "../types";

test("test-only rich proposal bounds abilities and related class stats and real evidence IDs", () => {
  const p = {
    decision: "propose",
    hypothesis: "Medic role needs sustain",
    rationale: "Test fixture, not live evidence",
    evidenceIds: ["real-id:L2"],
    expectedEffects: ["more healing"],
    manualReview: [],
    changes: [
      { path: "abilities.patch.healAmount", value: 2 },
      { path: "unitStats.medic.maxHp", value: 6 },
    ],
  };
  expect(v2.validateProposal(p, BALANCE, ["real-id:L2"]).balance.abilities.patch.healAmount).toBe(
    2,
  );
  for (const patch of [
    { evidenceIds: ["invented"] },
    { changes: [{ path: "maxRounds", value: 21 }] },
    { changes: [{ path: "abilities.patch.healAmount", value: 99 }] },
    {
      changes: [
        { path: "unitStats.oracle.maxHp", value: 8 },
        { path: "unitStats.medic.maxHp", value: 6 },
      ],
    },
  ])
    expect(() => v2.validateProposal({ ...p, ...patch }, BALANCE, ["real-id:L2"])).toThrow();
  expect(() => v2.validateProposal({ ...p, code: "execute" }, BALANCE, ["real-id:L2"])).toThrow();
});
