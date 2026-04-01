import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runCommercialProjectsShowcase } from "../../tools/scripts/commercial-projects-showcase.mjs";

test("commercial projects showcase validates all five project packs", { concurrency: false }, async () => {
  const report = await runCommercialProjectsShowcase();
  assert.equal(report.summary.totalProjects, 5);
  assert.equal(report.summary.failedProjects, 0);
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.scorePercent, 100);
  assert.deepEqual(
    report.projects.map((project) => project.packId),
    [
      "secops-runtime-guard",
      "revenue-cycle-copilot",
      "supply-chain-resilience",
      "clinical-quality-signal",
      "board-risk-cockpit"
    ]
  );
  assert.ok(report.projects.every((project) => project.passed === true));
  assert.ok(report.projects.every((project) => project.checks.length >= 5));
  assert.ok(
    report.projects.every((project) =>
      project.checks.some((check) => check.id === "connectors_registered") &&
      project.checks.some((check) => check.id === "simulation_run") &&
      project.checks.some((check) => check.id === "live_governance_path") &&
      project.checks.some((check) => check.id === "deterministic_graph") &&
      project.checks.some((check) => check.id === "evidence_presence")
    )
  );
});

test("commercial projects showcase writes report artifact", { concurrency: false }, async () => {
  await runCommercialProjectsShowcase();
  const raw = await readFile("docs/assets/demo/commercial-projects-showcase-report.json", "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.suite, "commercial-projects-showcase");
  assert.equal(parsed.summary.totalProjects, 5);
  assert.equal(parsed.summary.status, "PASS");
  assert.equal(parsed.summary.scorePercent, 100);
  assert.ok(parsed.projects.every((project) => project.checks.length >= 5));
});
