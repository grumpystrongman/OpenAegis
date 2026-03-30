#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const auditableRoots = ["backend", "frontend", "tools", "tests", "infra", "deployments"];
const excludedDirs = new Set(["dist", "node_modules", ".git", ".brv", "docs", ".tmp-test"]);
const excludedFiles = new Set(["commercial-audit.mjs", "codebase-line-audit.mjs"]);
const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".sh", ".yml", ".yaml", ".sql"]);

const markerPatterns = [
  { id: "placeholder_or_skeleton", regex: /\b(placeholder|skeleton)\b/i },
  { id: "todo_or_fixme", regex: /\b(todo|fixme)\b/i },
  { id: "not_implemented", regex: /\b(not implemented|not_implemented)\b/i },
  { id: "coming_soon_or_stub", regex: /\b(coming soon|stub)\b/i }
];

const walkFiles = async (root) => {
  const files = [];
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) stack.push(fullPath);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (codeExtensions.has(extension)) files.push(fullPath);
    }
  }
  return files;
};

const run = async () => {
  const findings = [];
  let filesReviewed = 0;
  let linesReviewed = 0;

  for (const root of auditableRoots) {
    const files = await walkFiles(root);
    for (const file of files) {
      const fileName = file.split(/[\\/]/).pop() ?? "";
      if (excludedFiles.has(fileName)) continue;
      const content = await readFile(file, "utf8").catch(() => "");
      if (!content) continue;
      filesReviewed += 1;
      const lines = content.split(/\r?\n/);
      linesReviewed += lines.length;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        for (const pattern of markerPatterns) {
          if (pattern.regex.test(line)) {
            findings.push({
              marker: pattern.id,
              file: file.replace(/\\/g, "/"),
              line: index + 1,
              text: line.trim()
            });
          }
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    suite: "codebase-line-audit",
    scope: {
      roots: auditableRoots,
      filesReviewed,
      linesReviewed
    },
    findings,
    summary: {
      totalFindings: findings.length,
      scorePercent: findings.length === 0 ? 100 : 0,
      status: findings.length === 0 ? "PASS" : "FAIL"
    }
  };

  await mkdir(resolve("docs", "assets", "demo"), { recursive: true });
  await writeFile(resolve("docs/assets/demo/codebase-line-audit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.status !== "PASS") process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
