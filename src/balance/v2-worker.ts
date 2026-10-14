import { TypeSafeClient } from "@typesafe-ai/sdk";
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { BALANCE } from "../types";
import type { BalanceConfig } from "../types";
import { playMatch, loadCredential, errorCategory } from "./match";
import type { MatchRequest } from "./match";
import { atomicJSON, hash } from "./core";
import { validateBalance } from "./v2-core";
const ANCHOR = structuredClone(BALANCE);
export function installBalance(value: BalanceConfig) {
  validateBalance(value, ANCHOR);
  for (const cls of Object.keys(BALANCE.unitStats))
    Object.assign((BALANCE.unitStats as any)[cls], (value.unitStats as any)[cls]);
  for (const ability of Object.keys(BALANCE.abilities))
    Object.assign((BALANCE.abilities as any)[ability], (value.abilities as any)[ability]);
}
if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw Error("Request required");
  const request = JSON.parse(readFileSync(path, "utf8")) as MatchRequest,
    dir = dirname(path);
  const fd = openSync(`${dir}/events.jsonl`, "ax", 0o600);
  try {
    installBalance(request.balance);
    const apiKey = loadCredential();
    delete process.env.TYPESAFE_API_KEY;
    const result = await playMatch(
      request,
      new TypeSafeClient({
        apiKey,
        defaultModel: "jev-latest",
        baseURL: "https://api.typesafe.ai",
        logLevel: "off",
      }),
      (event) => {
        appendFileSync(fd, JSON.stringify(event) + "\n");
        fsyncSync(fd);
      },
    );
    atomicJSON(`${dir}/result.json`, result);
  } catch (error) {
    atomicJSON(`${dir}/worker-diagnostic.json`, { errorCategory: errorCategory(error) });
    atomicJSON(`${dir}/result.json`, {
      clean: false,
      winner: null,
      reason: null,
      rounds: 0,
      decisions: 0,
      failedDecisions: 1,
      failure: "worker_error",
      codeCommit: request.codeCommit,
      requestHash: hash(request),
    });
    process.exitCode = 1;
  } finally {
    closeSync(fd);
  }
}
