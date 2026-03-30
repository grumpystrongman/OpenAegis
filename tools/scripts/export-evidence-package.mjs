#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = resolve("docs", "assets", "evidence-packages", packageId);

const requiredFiles = [
  "docs/assets/demo/commercial-proof-report.json",
  "docs/assets/demo/load-test-report.json",
  "docs/assets/demo/chaos-report.json",
  "docs/assets/demo/pilot-demo-output.json",
  "docs/readiness/HOSPITAL-PRODUCTION-GATE.md",
  "docs/readiness/SRE-RUNBOOK.md",
  "docs/security/HARDENING-CONTROLS-MATRIX.md",
  "docs/threat-model.md",
  "docs/data-governance.md"
];

const optionalFiles = [
  "docs/assets/demo/readiness-gate-report.json"
];

const run = async () => {
  await mkdir(outputDir, { recursive: true });
  const copied = [];
  const missing = [];

  for (const relativePath of [...requiredFiles, ...optionalFiles]) {
    const source = resolve(relativePath);
    const destination = resolve(outputDir, relativePath.replace(/^[^/]+\//, ""));
    try {
      await mkdir(resolve(destination, ".."), { recursive: true });
      await cp(source, destination, { recursive: true });
      copied.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }

  const proofSummaryRaw = await readFile(resolve("docs/assets/demo/commercial-proof-report.json"), "utf8").catch(() => "{}");
  const readinessSummaryRaw = await readFile(resolve("docs/assets/demo/readiness-gate-report.json"), "utf8").catch(() => "{}");

  const missingRequired = missing.filter((file) => requiredFiles.includes(file));
  const manifest = {
    packageId,
    generatedAt: new Date().toISOString(),
    copied,
    missing,
    missingRequired,
    summaries: {
      commercialProof: JSON.parse(proofSummaryRaw),
      readinessGate: JSON.parse(readinessSummaryRaw)
    }
  };

  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const status = missingRequired.length === 0 ? "PASS" : "FAIL";
  console.log(JSON.stringify({ status, outputDir, manifest }, null, 2));
  if (status === "FAIL") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
