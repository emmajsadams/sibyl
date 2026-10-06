import { expect, test } from "bun:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { BALANCE } from "../types";
import { applyBalance, credential, failureKind, playMatch } from "./match";
import type { MatchRequest } from "./match";
import { isClean } from "./core";

const request = (): MatchRequest => ({
  config: {
    player: { units: [{ name: "P", class: "sentinel", prompt: "Wait" }], placementPrompt: "Place" },
    opponent: {
      units: [{ name: "O", class: "sentinel", prompt: "Wait" }],
      placementPrompt: "Place",
    },
  },
  balance: structuredClone(BALANCE),
  codeCommit: "fixture-only",
  cycleHash: "fixture-only",
  attempt: 1,
});
function boundary(failAt = Infinity, malformedAt = Infinity) {
  let calls = 0;
  return new TypeSafeClient({
    apiKey: "unit-test-only",
    fetch: async (_url, init) => {
      calls++;
      if (calls === failAt) return new Response("test-only upstream unavailable", { status: 502 });
      const body = JSON.parse(String(init?.body)),
        options = body.questions.action.criteria;
      const selected =
        Object.keys(options).find((k) => JSON.parse(options[k]).type === "wait") ??
        Object.keys(options)[0];
      return Response.json({
        model: "jev-fixture-not-an-experiment",
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {
          action: {
            type: "choice",
            choice: calls === malformedAt ? "invalid" : selected,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(options).map((k) => [k, k === selected ? 1 : 0]),
            ),
          },
        },
      });
    },
  });
}
test("credential parser only accepts a single literal assignment, never shell expansion", () => {
  expect(credential("# comment\nexport TYPESAFE_API_KEY='test-only'\n")).toBe("test-only");
  for (const text of [
    "",
    "TYPESAFE_API_KEY=$(command)",
    "TYPESAFE_API_KEY=x\nTYPESAFE_API_KEY=y",
    "TYPESAFE_API_KEY=",
  ])
    expect(() => credential(text)).toThrow();
});
test("balance loader rejects mechanics, prompts and non-whitelisted numeric changes", () => {
  const original = structuredClone(BALANCE);
  try {
    const b = structuredClone(original);
    b.unitStats.sentinel.maxHp = 5;
    applyBalance(b);
    expect(BALANCE.unitStats.sentinel.maxHp).toBe(5);
    const bad = structuredClone(b);
    bad.maxRounds = 21;
    expect(() => applyBalance(bad)).toThrow();
  } finally {
    applyBalance(original);
  }
});
test("isolated worker real engine fixture records both placement decisions and every action", async () => {
  const events: any[] = [];
  const r = await playMatch(request(), boundary(), (e) => events.push(e));
  expect(isClean(r)).toBe(true);
  expect(r.winner).toBe("draw");
  expect(r.reason).toBe("Stalemate after 20 rounds — draw (6 HP each)");
  expect(r.decisions).toBe(82);
  expect(events.filter((e) => e.type === "provider_start")).toHaveLength(82);
  expect(events.filter((e) => e.type === "provider_response")).toHaveLength(82);
  expect(
    events.filter((e) => e.type === "engine_event" && e.event.type === "jev_decision"),
  ).toHaveLength(82);
});
test("second-action 502 preserves first successful decision and rejects whole game", async () => {
  const events: any[] = [];
  const r = await playMatch(request(), boundary(4), (e) => events.push(e));
  expect(isClean(r)).toBe(false);
  expect(r.failure).toBe("http_502");
  expect(r.decisions).toBe(4);
  expect(r.failedDecisions).toBe(1);
  expect(r.winner).toBeNull();
  expect(events.filter((e) => e.type === "resolved_action")).toHaveLength(1);
  expect(events.filter((e) => e.type === "provider_start")).toHaveLength(4);
  expect(events.filter((e) => e.type === "provider_failure")).toHaveLength(1);
});
test("malformed provider decision cannot become a clean engine outcome", async () => {
  const r = await playMatch(request(), boundary(Infinity, 4), () => {});
  expect(r.failure).toBe("decision_error");
  expect(r.failedDecisions).toBe(1);
  expect(isClean(r)).toBe(false);
});
test("502 classifier uses status fields, never arbitrary exception prose", () => {
  expect(failureKind({ status: 502 })).toBe("http_502");
  expect(failureKind(new Error("502"))).toBe("provider_error");
  expect(failureKind({ status: 401 })).toBe("provider_error");
});
