import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { atomicJSON, hash, isClean, parseResult } from "./core";
import { journalQuality, summarizeQuality } from "./v2-metrics";
import { defaultObjective, validateProposal } from "./v2-core";
import { codexDesign, sourceHashes } from "./v2-runner";

/** Read-only re-analysis, never a v1 migration or candidate acceptance. */
if (import.meta.main) {
  const args = process.argv.slice(2),
    get = (key: string) => {
      const i = args.indexOf(key);
      return i < 0 ? undefined : args[i + 1];
    };
  const journal = get("--journal"),
    output = get("--output"),
    sourceMethodology = Number(get("--source-methodology"));
  if (!journal || !output || ![1, 2].includes(sourceMethodology))
    throw Error(
      "Usage: bun run src/balance/v2-review.ts --journal EVENTS --output NEW_DIR --source-methodology 1|2 [--design]",
    );
  const source = resolve(journal),
    dest = resolve(output),
    dir = dirname(source);
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  const result = parseResult(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")));
  if (!result || !isClean(result) || result.requestHash !== hash(request))
    throw Error("Only verified clean real journal/request pairs may be reviewed");
  mkdirSync(dest, { recursive: false, mode: 0o700 });
  const evidence = await journalQuality(source, `source-attempt-${request.attempt}`);
  if (!evidence.complete) throw Error("No completed game event");
  const objective = defaultObjective();
  const metadata = {
    analysisMethodology: 2,
    sourceMethodology,
    sourceCodeCommit: result.codeCommit,
    sourceRequestHash: result.requestHash,
    sourceJournalHash: evidence.journalHash,
    analysisSourceHashes: sourceHashes(),
    objective,
    eligibility:
      "Review only; historical event coverage may be incomplete. Never used for v2 acceptance or mixed-policy evaluation.",
  };
  atomicJSON(join(dest, "evidence.json"), {
    ...metadata,
    summary: summarizeQuality([evidence]),
    evidence: [evidence],
  });
  if (args.includes("--design")) {
    const raw = join(dest, "raw");
    mkdirSync(raw, { mode: 0o700 });
    const output = await codexDesign([evidence], join(raw, "designer"), 600000, {
      balance: request.balance,
      objective,
    });
    const { proposal } = validateProposal(output, request.balance, [
      evidence.evidenceId,
      ...evidence.references.map((r) => r.id),
    ]);
    atomicJSON(join(dest, "proposal.json"), {
      ...metadata,
      proposal,
      validated: true,
      candidateApplied: false,
    });
    console.log(
      JSON.stringify({
        decision: proposal.decision,
        validated: true,
        candidateApplied: false,
        evidenceId: evidence.evidenceId,
        skippedLines: evidence.skippedLines,
      }),
    );
  } else
    console.log(
      JSON.stringify({
        complete: evidence.complete,
        evidenceId: evidence.evidenceId,
        journalHash: evidence.journalHash,
        skippedLines: evidence.skippedLines,
      }),
    );
}
