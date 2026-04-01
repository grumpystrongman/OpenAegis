import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runTrustLayerProof } from "../../tools/scripts/prove-trust-layer.mjs";

test("trust layer proof validates three distinct commercial examples", { concurrency: false }, async () => {
  const report = await runTrustLayerProof();
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.totalExamples, 3);
  assert.equal(report.summary.failedExamples, 0);

  const exampleIds = report.examples.map((example) => example.exampleId);
  assert.deepEqual(exampleIds, [
    "healthcare-discharge-orchestration",
    "finance-operations-guardrails",
    "secops-containment-and-governance"
  ]);
  assert.ok(report.examples.every((example) => example.passed === true));
});

test("trust layer proof writes artifact for audit and buyer review", { concurrency: false }, async () => {
  await runTrustLayerProof();
  const raw = await readFile("docs/assets/demo/trust-layer-proof-report.json", "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.suite, "trust-layer-end-to-end-proof");
  assert.equal(parsed.summary.status, "PASS");
  assert.equal(parsed.summary.totalExamples, 3);
});
