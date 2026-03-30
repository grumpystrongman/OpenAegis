#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredPaths = [
  "docs/assets/enterprise-trust-pack/latest/manifest.json",
  "docs/assets/enterprise-trust-pack/latest/EXECUTIVE-BRIEF.md",
  "docs/assets/enterprise-trust-pack/latest/compliance/CONTROL-CROSSWALK.json",
  "docs/assets/enterprise-trust-pack/latest/compliance/EXTERNAL-PENTEST-READY-CHECKLIST.md",
  "docs/assets/demo/readiness-gate-report.json",
  "docs/assets/demo/commercial-audit-report.json",
  "docs/assets/demo/security-regression-report.json"
];

const readJson = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

const isReadinessPassOrInterim = (readiness) => {
  const priorPass =
    String(readiness?.summary?.status ?? "FAIL") === "PASS" &&
    Number(readiness?.summary?.scorePercent ?? 0) >= 98;
  if (priorPass) return true;

  const commands = Array.isArray(readiness?.commands)
    ? readiness.commands
        .filter((command) => command && typeof command.id === "string")
        .map((command) => ({
          id: command.id,
          status: command.status
        }))
    : [];

  const requiredPreTrustChecks = [
    "typecheck",
    "build",
    "test",
    "test-surface",
    "infra",
    "security-regression",
    "smoke",
    "proof",
    "trust-proof",
    "codebase-audit"
  ];

  const preTrustChecksPassed = requiredPreTrustChecks.every((id) =>
    commands.some((command) => command.id === id && command.status === "PASS")
  );
  const nonTrustFailures = commands.filter(
    (command) =>
      command.status !== "PASS" &&
      command.id !== "trust-pack" &&
      command.id !== "trust-pack-audit" &&
      command.id !== "evidence"
  );

  return (
    preTrustChecksPassed &&
    nonTrustFailures.length === 0 &&
    commands.some(
      (command) =>
        (command.id === "trust-pack" || command.id === "trust-pack-audit") && command.status === "FAIL"
    )
  );
};

const run = async () => {
  const pathChecks = [];
  for (const file of requiredPaths) {
    try {
      const info = await stat(resolve(file));
      pathChecks.push({ file, passed: info.isFile(), sizeBytes: info.size });
    } catch {
      pathChecks.push({ file, passed: false, sizeBytes: 0 });
    }
  }

  const manifest = await readJson("docs/assets/enterprise-trust-pack/latest/manifest.json").catch(() => null);
  const crosswalk = await readJson("docs/assets/enterprise-trust-pack/latest/compliance/CONTROL-CROSSWALK.json").catch(() => null);
  const readiness = await readJson("docs/assets/demo/readiness-gate-report.json").catch(() => null);
  const commercialAudit = await readJson("docs/assets/demo/commercial-audit-report.json").catch(() => null);
  const securityRegression = await readJson("docs/assets/demo/security-regression-report.json").catch(() => null);

  const checks = [
    {
      checkId: "required_files_present",
      passed: pathChecks.every((check) => check.passed),
      details: pathChecks
    },
    {
      checkId: "trust_pack_manifest_status",
      passed: String(manifest?.summary?.status ?? "FAIL") === "PASS",
      details: {
        status: manifest?.summary?.status ?? "MISSING",
        controlCount: Number(manifest?.summary?.controlCount ?? 0),
        frameworks: manifest?.summary?.frameworks ?? []
      }
    },
    {
      checkId: "framework_coverage_complete",
      passed:
        Array.isArray(crosswalk?.frameworks) &&
        crosswalk.frameworks.includes("SOC2") &&
        crosswalk.frameworks.includes("ISO27001") &&
        crosswalk.frameworks.includes("HIPAA"),
      details: {
        frameworks: crosswalk?.frameworks ?? []
      }
    },
    {
      checkId: "control_count_threshold",
      passed: Number(crosswalk?.controls?.length ?? 0) >= 18,
      details: {
        controlCount: Number(crosswalk?.controls?.length ?? 0),
        threshold: 18
      }
    },
    {
      checkId: "readiness_gate_still_passed",
      passed: isReadinessPassOrInterim(readiness),
      details: {
        status: readiness?.summary?.status ?? "MISSING",
        scorePercent: Number(readiness?.summary?.scorePercent ?? 0)
      }
    },
    {
      checkId: "commercial_audit_still_passed",
      passed: String(commercialAudit?.summary?.status ?? "FAIL") === "PASS",
      details: {
        status: commercialAudit?.summary?.status ?? "MISSING",
        scorePercent: Number(commercialAudit?.summary?.scorePercent ?? 0)
      }
    },
    {
      checkId: "security_regression_still_passed",
      passed: String(securityRegression?.summary?.status ?? "FAIL") === "PASS",
      details: {
        status: securityRegression?.summary?.status ?? "MISSING",
        scorePercent: Number(securityRegression?.summary?.scorePercent ?? 0)
      }
    }
  ];

  const passedChecks = checks.filter((check) => check.passed).length;
  const report = {
    generatedAt: new Date().toISOString(),
    suite: "enterprise-trust-pack-audit",
    checks,
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      scorePercent: Number(((passedChecks / checks.length) * 100).toFixed(2)),
      status: checks.every((check) => check.passed) ? "PASS" : "FAIL"
    }
  };

  await mkdir(resolve("docs", "assets", "demo"), { recursive: true });
  await writeFile(
    resolve("docs/assets/demo/enterprise-trust-pack-audit-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
  if (report.summary.status !== "PASS") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
