import test from "node:test";
import assert from "node:assert/strict";
import { computeReadinessScore } from "../../tools/scripts/readiness-gate.mjs";

test("computeReadinessScore passes when all mandatory checks pass and score >= 98", () => {
  const result = computeReadinessScore({
    commands: [
      { status: "PASS", weight: 65, mandatory: true }
    ],
    signals: {
      proofScorePercent: 100,
      loadScorePercent: 100,
      chaosScorePercent: 100
    }
  });

  assert.equal(result.scorePercent, 100);
  assert.equal(result.pass, true);
});

test("computeReadinessScore fails when mandatory checks fail", () => {
  const result = computeReadinessScore({
    commands: [
      { status: "PASS", weight: 50, mandatory: true },
      { status: "FAIL", weight: 15, mandatory: true }
    ],
    signals: {
      proofScorePercent: 100,
      loadScorePercent: 100,
      chaosScorePercent: 100
    }
  });

  assert.equal(result.pass, false);
  assert.equal(result.mandatoryFailed, true);
});

test("computeReadinessScore fails when overall score is below 98", () => {
  const result = computeReadinessScore({
    commands: [
      { status: "PASS", weight: 65, mandatory: true }
    ],
    signals: {
      proofScorePercent: 90,
      loadScorePercent: 90,
      chaosScorePercent: 90
    }
  });

  assert.ok(result.scorePercent < 98);
  assert.equal(result.pass, false);
});
