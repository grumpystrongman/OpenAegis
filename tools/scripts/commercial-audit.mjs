#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const auditableRoots = ["backend/services", "backend/shared", "frontend/apps", "tools/scripts", "tests/commercial"];
const excludedDirs = new Set(["dist", "node_modules", ".git", ".brv", "docs", ".tmp-test"]);
const placeholderPattern = /\b(placeholder|skeleton)\b/i;
const excludedFiles = new Set(["commercial-audit.mjs", "codebase-line-audit.mjs"]);

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
};

const walkFiles = async (root) => {
  const files = [];
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) stack.push(fullPath);
        continue;
      }
      files.push(fullPath);
    }
  }
  return files;
};

const detectPlaceholders = async () => {
  const findings = [];
  for (const root of auditableRoots) {
    const files = await walkFiles(root);
    for (const file of files) {
      const fileName = file.split(/[\\/]/).pop() ?? "";
      if (excludedFiles.has(fileName)) continue;
      const content = await readFile(file, "utf8").catch(() => "");
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (placeholderPattern.test(line)) {
          findings.push({
            file: file.replace(/\\/g, "/"),
            line: index + 1,
            text: line.trim()
          });
        }
      }
    }
  }
  return findings;
};

const run = async () => {
  const commercialProof = await readJson("docs/assets/demo/commercial-proof-report.json", null);
  const trustProof = await readJson("docs/assets/demo/trust-layer-proof-report.json", null);
  const codebaseAudit = await readJson("docs/assets/demo/codebase-line-audit-report.json", null);
  const placeholderFindings = await detectPlaceholders();

  const checks = [
    {
      checkId: "license_files_present",
      passed:
        (await readFile("LICENSE", "utf8").catch(() => "")).length > 0 &&
        (await readFile("LICENSE-COMMERCIAL.md", "utf8").catch(() => "")).length > 0,
      details: {
        required: ["LICENSE", "LICENSE-COMMERCIAL.md"]
      }
    },
    {
      checkId: "no_placeholder_or_skeleton_markers",
      passed: placeholderFindings.length === 0,
      details: {
        findings: placeholderFindings
      }
    },
    {
      checkId: "commercial_proof_artifact_valid",
      passed:
        Number(commercialProof?.summary?.scorePercent ?? 0) >= 98 &&
        String(commercialProof?.summary?.status ?? "FAIL") === "PASS",
      details: {
        scorePercent: Number(commercialProof?.summary?.scorePercent ?? 0),
        status: commercialProof?.summary?.status ?? "MISSING"
      }
    },
    {
      checkId: "trust_layer_proof_passed",
      passed:
        String(trustProof?.summary?.status ?? "FAIL") === "PASS" &&
        Number(trustProof?.summary?.totalExamples ?? 0) >= 3,
      details: {
        status: trustProof?.summary?.status ?? "MISSING",
        totalExamples: Number(trustProof?.summary?.totalExamples ?? 0),
        passedExamples: Number(trustProof?.summary?.passedExamples ?? 0)
      }
    },
    {
      checkId: "codebase_line_audit_passed",
      passed:
        String(codebaseAudit?.summary?.status ?? "FAIL") === "PASS" &&
        Number(codebaseAudit?.summary?.totalFindings ?? 1) === 0,
      details: {
        status: codebaseAudit?.summary?.status ?? "MISSING",
        totalFindings: Number(codebaseAudit?.summary?.totalFindings ?? -1),
        filesReviewed: Number(codebaseAudit?.scope?.filesReviewed ?? 0),
        linesReviewed: Number(codebaseAudit?.scope?.linesReviewed ?? 0)
      }
    }
  ];

  const passedChecks = checks.filter((check) => check.passed).length;
  const scorePercent = Number(((passedChecks / checks.length) * 100).toFixed(2));
  const report = {
    generatedAt: new Date().toISOString(),
    suite: "commercial-readiness-audit",
    checks,
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      scorePercent,
      status: checks.every((check) => check.passed) ? "PASS" : "FAIL"
    }
  };

  await mkdir(resolve("docs/assets/demo"), { recursive: true });
  await writeFile("docs/assets/demo/commercial-audit-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.status !== "PASS") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
