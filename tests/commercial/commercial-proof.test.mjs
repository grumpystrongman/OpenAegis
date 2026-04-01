import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runCommercialProof } from "../../tools/scripts/commercial-proof.mjs";

test("commercial proof report passes all claim checks", { concurrency: false }, async () => {
  const report = await runCommercialProof();
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.failedClaims, 0);
  assert.ok(report.summary.scorePercent >= 99);
  assert.ok(Array.isArray(report.claims));
  assert.ok(report.claims.some((claim) => claim.claimId === "policy_gate_enforced"));
});

test("commercial proof report is written and readable", { concurrency: false }, async () => {
  await runCommercialProof();
  const raw = await readFile("docs/assets/demo/commercial-proof-report.json", "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.profile, "commercial-readiness");
  assert.ok(Array.isArray(parsed.checks));
  assert.ok(parsed.checks.length >= 7);
});
