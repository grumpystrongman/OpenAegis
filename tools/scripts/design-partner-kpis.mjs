#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const readJson = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

const kpiThresholds = {
  maxApprovalLatencyMs: 1500,
  minBlockedRiskyActions: 3,
  minAuditCompletenessPercent: 98
};

const computeStatus = (actual, comparator, expected) => {
  if (comparator === "lte") return actual <= expected ? "PASS" : "FAIL";
  if (comparator === "gte") return actual >= expected ? "PASS" : "FAIL";
  return "FAIL";
};

const buildPilotKpis = ({ trustProof, readiness }) => {
  const getExample = (id) => trustProof.examples.find((example) => example.exampleId === id) ?? { metrics: {}, steps: [] };

  const healthcare = getExample("healthcare-discharge-orchestration");
  const finance = getExample("finance-operations-guardrails");
  const secops = getExample("secops-containment-and-governance");

  const globalApprovalLatency = Number(healthcare.metrics?.approvalLatencyMs ?? 0);
  const globalBlockedActions = Number(trustProof.kpis?.blockedRiskyActions ?? 0);
  const globalAuditCompleteness = Number(trustProof.kpis?.auditCompletenessPercent ?? 0);

  const kpis = {
    healthcare: {
      approvalLatencyMs: globalApprovalLatency,
      blockedRiskyActions: Number(healthcare.metrics?.blockedRiskyActions ?? 0),
      auditCompletenessPercent: Number(healthcare.metrics?.auditCompletenessPercent ?? 0)
    },
    finance: {
      blockedRiskyActions: Number(finance.metrics?.blockedRiskyActions ?? 0),
      auditCompletenessPercent: Number(finance.metrics?.auditCompletenessPercent ?? 0),
      idempotencyReplayVerified: Boolean(
        finance.steps.some((step) => step.step === "verify_idempotent_finance_automation" && step.data?.replayed === true)
      )
    },
    secops: {
      blockedRiskyActions: Number(secops.metrics?.blockedRiskyActions ?? 0),
      auditCompletenessPercent: Number(secops.metrics?.auditCompletenessPercent ?? 0),
      containmentLatencyMs: Number(secops.metrics?.containmentLatencyMs ?? 0)
    },
    global: {
      readinessScorePercent: Number(readiness.summary?.scorePercent ?? 0),
      approvalLatencyMs: globalApprovalLatency,
      blockedRiskyActions: globalBlockedActions,
      auditCompletenessPercent: globalAuditCompleteness
    }
  };

  const checks = [
    {
      checkId: "approval_latency",
      expected: `<= ${kpiThresholds.maxApprovalLatencyMs}ms`,
      actual: `${kpis.global.approvalLatencyMs}ms`,
      status: computeStatus(kpis.global.approvalLatencyMs, "lte", kpiThresholds.maxApprovalLatencyMs)
    },
    {
      checkId: "blocked_risky_actions",
      expected: `>= ${kpiThresholds.minBlockedRiskyActions}`,
      actual: `${kpis.global.blockedRiskyActions}`,
      status: computeStatus(kpis.global.blockedRiskyActions, "gte", kpiThresholds.minBlockedRiskyActions)
    },
    {
      checkId: "audit_completeness",
      expected: `>= ${kpiThresholds.minAuditCompletenessPercent}%`,
      actual: `${kpis.global.auditCompletenessPercent}%`,
      status: computeStatus(
        kpis.global.auditCompletenessPercent,
        "gte",
        kpiThresholds.minAuditCompletenessPercent
      )
    },
    {
      checkId: "readiness_score",
      expected: ">= 98%",
      actual: `${kpis.global.readinessScorePercent}%`,
      status: computeStatus(kpis.global.readinessScorePercent, "gte", 98)
    }
  ];

  const failedChecks = checks.filter((check) => check.status !== "PASS").length;
  return {
    generatedAt: new Date().toISOString(),
    suite: "design-partner-pilot-kpis",
    thresholds: kpiThresholds,
    pilots: kpis,
    checks,
    summary: {
      totalChecks: checks.length,
      failedChecks,
      status: failedChecks === 0 ? "PASS" : "FAIL"
    }
  };
};

const run = async () => {
  const trustProof = await readJson("docs/assets/demo/trust-layer-proof-report.json");
  const readiness = await readJson("docs/assets/demo/readiness-gate-report.json");
  const report = buildPilotKpis({ trustProof, readiness });

  await mkdir(resolve("docs", "assets", "demo"), { recursive: true });
  await writeFile(resolve("docs/assets/demo/design-partner-kpis.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.status !== "PASS") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
