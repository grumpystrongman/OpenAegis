#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const packageId = new Date().toISOString().replace(/[:.]/g, "-");
const packageRoot = resolve("docs", "assets", "security-evidence-pack", packageId);
const latestRoot = resolve("docs", "assets", "security-evidence-pack", "latest");

const requiredFiles = [
  "docs/assets/demo/readiness-gate-report.json",
  "docs/assets/demo/commercial-proof-report.json",
  "docs/assets/demo/trust-layer-proof-report.json",
  "docs/assets/demo/commercial-audit-report.json",
  "docs/assets/demo/load-test-report.json",
  "docs/assets/demo/chaos-report.json",
  "docs/assets/demo/test-surface-report.json",
  "docs/assets/demo/design-partner-kpis.json",
  "docs/threat-model.md",
  "docs/data-governance.md",
  "docs/readiness/HOSPITAL-PRODUCTION-GATE.md",
  "docs/security/HARDENING-CONTROLS-MATRIX.md"
];

const hashFile = async (path) => {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
};

const copyWithParents = async (root, relativePath) => {
  const destination = resolve(root, relativePath.replace(/^docs[\\/]/, ""));
  await mkdir(resolve(destination, ".."), { recursive: true });
  await cp(resolve(relativePath), destination, { recursive: true });
  return destination;
};

const run = async () => {
  await mkdir(packageRoot, { recursive: true });
  const missing = [];
  const copied = [];
  const checksums = [];

  for (const relativePath of requiredFiles) {
    try {
      const destination = await copyWithParents(packageRoot, relativePath);
      const sha256 = await hashFile(destination);
      const sizeBytes = (await stat(destination)).size;
      copied.push(relativePath);
      checksums.push({ file: relativePath, sha256, sizeBytes });
    } catch {
      missing.push(relativePath);
    }
  }

  const readiness = JSON.parse(await readFile(resolve("docs/assets/demo/readiness-gate-report.json"), "utf8"));
  const trust = JSON.parse(await readFile(resolve("docs/assets/demo/trust-layer-proof-report.json"), "utf8"));
  const commercial = JSON.parse(await readFile(resolve("docs/assets/demo/commercial-proof-report.json"), "utf8"));
  const kpis = JSON.parse(await readFile(resolve("docs/assets/demo/design-partner-kpis.json"), "utf8"));

  const execSummary = [
    "# OpenAegis Security Evidence Pack",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Package ID: ${packageId}`,
    "",
    "## Executive Results",
    `- Readiness gate: ${readiness.summary?.status ?? "UNKNOWN"} (${readiness.summary?.scorePercent ?? 0}%)`,
    `- Trust proof: ${trust.summary?.status ?? "UNKNOWN"} (${trust.summary?.passedExamples ?? 0}/${trust.summary?.totalExamples ?? 0} examples passed)`,
    `- Commercial proof: ${commercial.summary?.status ?? "UNKNOWN"} (${commercial.summary?.passedClaims ?? 0}/${commercial.summary?.totalClaims ?? 0} claims passed)`,
    `- Design partner KPI gate: ${kpis.summary?.status ?? "UNKNOWN"}`,
    "",
    "## KPI Snapshot",
    `- Approval latency (healthcare): ${kpis.pilots?.global?.approvalLatencyMs ?? "n/a"} ms`,
    `- Blocked risky actions (global): ${kpis.pilots?.global?.blockedRiskyActions ?? "n/a"}`,
    `- Audit completeness (global): ${kpis.pilots?.global?.auditCompletenessPercent ?? "n/a"}%`,
    "",
    "## Contents",
    ...copied.map((file) => `- ${file}`),
    "",
    "## Integrity",
    "SHA-256 checksums are listed in manifest.json."
  ].join("\n");

  await writeFile(resolve(packageRoot, "EXECUTIVE-SUMMARY.md"), `${execSummary}\n`, "utf8");

  const manifest = {
    packageId,
    generatedAt: new Date().toISOString(),
    status: missing.length === 0 ? "PASS" : "FAIL",
    missing,
    copied,
    checksums,
    snapshot: {
      readiness: readiness.summary,
      trust: trust.summary,
      commercial: commercial.summary,
      designPartnerKpis: kpis.summary
    }
  };
  await writeFile(resolve(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await rm(latestRoot, { recursive: true, force: true });
  await mkdir(latestRoot, { recursive: true });
  await cp(packageRoot, latestRoot, { recursive: true });
  await writeFile(
    resolve("docs", "assets", "security-evidence-pack", "latest.json"),
    `${JSON.stringify({ packageId, path: `docs/assets/security-evidence-pack/${packageId}` }, null, 2)}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        packageId,
        packagePath: `docs/assets/security-evidence-pack/${packageId}`,
        latestPath: "docs/assets/security-evidence-pack/latest",
        missing: manifest.missing
      },
      null,
      2
    )
  );
  if (manifest.status !== "PASS") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
