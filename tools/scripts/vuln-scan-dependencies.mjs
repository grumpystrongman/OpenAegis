#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportPath = resolve(repoRoot, "docs", "security", "VULN-REPORT-DEPENDENCIES.md");

const excludedDirs = new Set([
  ".git",
  ".brv",
  ".playwright-cli",
  ".tmp-test",
  ".volumes",
  "backups",
  "build",
  "coverage",
  "dist",
  "docs/assets/demo",
  "docs/assets/evidence-packages",
  "node_modules",
  "output"
]);

const textExtensions = new Set([
  ".bat",
  ".cjs",
  ".env",
  ".example",
  ".ini",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const lifecycleHooks = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepack",
  "postpack",
  "prepare",
  "prepublish",
  "prepublishOnly"
]);

const secretPatterns = [
  { id: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { id: "openai_api_key", regex: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { id: "aws_access_key_id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "google_api_key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "private_key_block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "url_with_embedded_credentials", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@[^/\s]+/i }
];

const envSecretAssignmentPattern =
  /^\s*(?:export\s+)?[A-Z0-9_]*(?:API[_-]?KEY|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CONNECTION[_-]?STRING|DSN)[A-Z0-9_]*\s*=\s*([^#\n]+)/;

const quotedSecretAssignmentPattern =
  /\b(?:api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|connection[_-]?string|dsn)\b\s*[:=]\s*(['"`])([^'"`]{8,})\1/i;

const safePlaceholderPattern =
  /(?:change[-_ ]?me|changeme|placeholder|sample|dummy|example|test|redacted|replace[-_ ]?me|your[-_ ]?|vault:\/\/secret\/|<[^>]+>)/i;

const npmInstallPattern = /\bnpm\s+(?:i|install)\b/i;
const safeInstallFlagsPattern = /(--ignore-scripts\b|\bnpm\s+ci\b|\bci\b)/i;
const acceptedDependencyInstallScriptPackages = new Set(["esbuild", "fsevents"]);

const walkFiles = async (roots = [repoRoot]) => {
  const files = [];
  const stack = roots.map((root) => resolve(repoRoot, root));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        const relative = fullPath.slice(repoRoot.length + 1).replace(/\\/g, "/");
        if (!excludedDirs.has(relative) && !excludedDirs.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      const relative = fullPath.slice(repoRoot.length + 1).replace(/\\/g, "/");
      const extension = extname(entry.name).toLowerCase();
      const isDockerfile = entry.name === "Dockerfile" || entry.name.toLowerCase().startsWith("dockerfile.");
      if (textExtensions.has(extension) || isDockerfile || entry.name === "Makefile" || entry.name === "Procfile") {
        files.push({
          absolutePath: fullPath,
          relativePath: relative
        });
      }
    }
  }

  return files;
};

const readJsonFile = async (path) => JSON.parse(await readFile(resolve(repoRoot, path), "utf8"));

const safeReadJsonFile = async (path) => {
  try {
    return await readJsonFile(path);
  } catch {
    return null;
  }
};

const runCommand = (command, args, options = {}) => {
  const startedAt = Date.now();
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          shell: false,
          ...options
        })
      : spawnSync(command, args, {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          shell: false,
          ...options
        });
  return {
    command: [command, ...args].join(" "),
    cwd: repoRoot,
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - startedAt,
    error: result.error ? String(result.error.message ?? result.error) : null
  };
};

const parseJsonMaybe = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const summarizeAuditResult = (raw) => {
  const metadata = raw?.metadata ?? {};
  const vulnerabilities = metadata.vulnerabilities ?? {};
  const topLevelVulns = raw?.vulnerabilities ?? {};
  const counts = {
    critical: Number(vulnerabilities.critical ?? 0),
    high: Number(vulnerabilities.high ?? 0),
    moderate: Number(vulnerabilities.moderate ?? 0),
    low: Number(vulnerabilities.low ?? 0),
    info: Number(vulnerabilities.info ?? 0),
    total: Number(vulnerabilities.total ?? 0)
  };

  const topFindings = Object.entries(topLevelVulns)
    .map(([name, item]) => ({
      name,
      severity: item?.severity ?? "unknown",
      effects: Array.isArray(item?.effects) ? item.effects : [],
      via: Array.isArray(item?.via)
        ? item.via.map((entry) => (typeof entry === "string" ? entry : entry?.title ?? entry?.source ?? "unknown"))
        : []
    }))
    .sort((left, right) => {
      const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };
      return (rank[left.severity] ?? 5) - (rank[right.severity] ?? 5) || left.name.localeCompare(right.name);
    })
    .slice(0, 10);

  return {
    auditReportVersion: raw?.auditReportVersion ?? null,
    dependencyCount:
      typeof metadata.dependencies === "object" && metadata.dependencies !== null
        ? Number(metadata.dependencies.total ?? 0)
        : Number(metadata.dependencies ?? 0),
    vulnerabilityCounts: counts,
    topFindings
  };
};

const scanPackageManifests = async () => {
  const files = (await walkFiles(["."]))
    .filter((file) => file.relativePath.endsWith("package.json"))
    .filter((file) => !file.relativePath.startsWith("docs/assets/"))
    .filter((file) => !file.relativePath.startsWith(".brv/"));

  const lifecycleFindings = [];
  for (const file of files) {
    const manifest = await safeReadJsonFile(file.relativePath);
    if (!manifest) continue;

    const lifecycleKeys = [];
    for (const key of Object.keys(manifest)) {
      if (lifecycleHooks.has(key) && typeof manifest[key] === "string" && manifest[key].trim().length > 0) {
        lifecycleKeys.push({
          hook: key,
          command: manifest[key]
        });
      }
    }

    const scripts = manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
    for (const [name, command] of Object.entries(scripts)) {
      if (lifecycleHooks.has(name) && typeof command === "string" && command.trim().length > 0) {
        lifecycleKeys.push({
          hook: name,
          command
        });
      }
    }

    for (const entry of lifecycleKeys) {
      lifecycleFindings.push({
        kind: "package_lifecycle_hook",
        file: file.relativePath,
        hook: entry.hook,
        command: entry.command
      });
    }
  }

  return lifecycleFindings;
};

const scanLockfileInstallScripts = async () => {
  const lockfile = await safeReadJsonFile("package-lock.json");
  const packages = lockfile?.packages && typeof lockfile.packages === "object" ? lockfile.packages : {};
  const findings = [];
  const acceptedFindings = [];

  for (const [name, entry] of Object.entries(packages)) {
    if (!entry || entry.hasInstallScript !== true) continue;
    const packagePath = name === "" ? "root" : name;
    const packageName = packagePath.split("/").pop() ?? packagePath;
    const finding = {
      kind: "dependency_install_script",
      package: packagePath,
      version: typeof entry.version === "string" ? entry.version : null,
      dev: entry.dev === true,
      optional: entry.optional === true,
      resolved: typeof entry.resolved === "string" ? entry.resolved : null
    };

    if (entry.optional === true || acceptedDependencyInstallScriptPackages.has(packageName)) {
      acceptedFindings.push(finding);
    } else {
      findings.push(finding);
    }
  }

  return { findings, acceptedFindings };
};

const scanNpmInstallDefaults = async () => {
  const files = await walkFiles(["tools", "frontend", "backend"]);
  const findings = [];

  for (const file of files) {
    const baseName = file.relativePath.split("/").pop() ?? "";
    const looksLikeScript =
      baseName === "Dockerfile" ||
      baseName.toLowerCase().startsWith("dockerfile.") ||
      file.relativePath.endsWith(".sh") ||
      file.relativePath.endsWith(".bash") ||
      file.relativePath.endsWith(".ps1") ||
      file.relativePath.endsWith(".cmd") ||
      file.relativePath.endsWith(".bat");

    if (!looksLikeScript) continue;

    const content = await readFile(file.absolutePath, "utf8").catch(() => "");
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("REM ")) continue;
      if (!npmInstallPattern.test(trimmed)) continue;
      if (safeInstallFlagsPattern.test(trimmed)) continue;

      findings.push({
        kind: "npm_install_default_scripts_enabled",
        file: file.relativePath,
        line: index + 1,
        command: trimmed
      });
    }
  }

  return findings;
};

const scanSecrets = async () => {
  const files = await walkFiles(["."]);
  const findings = [];

  for (const file of files) {
    if (file.relativePath.startsWith("docs/assets/")) continue;
    if (file.relativePath.startsWith(".brv/")) continue;

    const content = await readFile(file.absolutePath, "utf8").catch(() => "");
    if (!content) continue;
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line || line.includes("vault://secret/")) continue;

    for (const pattern of secretPatterns) {
        if (!pattern.regex.test(line)) continue;
        if (safePlaceholderPattern.test(line)) continue;
        findings.push({
          kind: "hardcoded_secret_pattern",
          pattern: pattern.id,
          file: file.relativePath,
          line: index + 1,
          snippet: line.trim()
        });
      }

      const envAssignmentMatch = line.match(envSecretAssignmentPattern);
      if (envAssignmentMatch) {
        const candidate = (envAssignmentMatch[1] ?? "").trim();
        if (candidate && !safePlaceholderPattern.test(candidate)) {
          findings.push({
            kind: "hardcoded_secret_assignment",
            file: file.relativePath,
            line: index + 1,
            snippet: line.trim()
          });
        }
      }

      const quotedAssignmentMatch = line.match(quotedSecretAssignmentPattern);
      if (quotedAssignmentMatch) {
        const candidate = quotedAssignmentMatch[2] ?? "";
        if (candidate && !safePlaceholderPattern.test(candidate)) {
          findings.push({
            kind: "hardcoded_secret_assignment",
            file: file.relativePath,
            line: index + 1,
            snippet: line.trim()
          });
        }
      }
    }
  }

  return findings;
};

const renderMarkdownReport = (report) => {
  const auditAll = report.commands.find((entry) => entry.id === "npm_audit_all");
  const auditProd = report.commands.find((entry) => entry.id === "npm_audit_prod");
  const auditAllCheck = report.checks.find((entry) => entry.checkId === "full_dependency_audit");
  const auditProdCheck = report.checks.find((entry) => entry.checkId === "production_dependency_audit");
  const secretScanCheck = report.checks.find((entry) => entry.checkId === "hardcoded_secret_scan");
  const lifecycle = report.findings.filter((entry) => entry.kind === "package_lifecycle_hook");
  const installScripts = report.findings.filter((entry) => entry.kind === "dependency_install_script");
  const acceptedInstallScripts = report.acceptedDependencyInstallScripts ?? [];
  const npmInstallDefaults = report.findings.filter((entry) => entry.kind === "npm_install_default_scripts_enabled");
  const secrets = report.findings.filter((entry) => entry.kind.startsWith("hardcoded_secret"));

  const bullet = (text) => `- ${text}`;
  const statusLine = (value) => {
    if (value === true) return "PASS";
    if (value === false) return "FAIL";
    return String(value);
  };
  const installScriptStatus =
    installScripts.length > 0 ? "FAIL" : acceptedInstallScripts.length > 0 ? "ACCEPTED" : "PASS";

  return [
    "# Dependency and Secrets Risk Scan",
    "",
    `Generated at: ${report.generatedAt}`,
    `Repository root: \`${report.repoRoot}\``,
    "",
    "## Scope",
    bullet("`npm audit` against the full dependency tree"),
    bullet("`npm audit --omit=dev` for production-only dependency risk"),
    bullet("Workspace manifest lifecycle hooks, lockfile install scripts, and accepted transitive install-script packages"),
    bullet("Executable scripts and Dockerfiles that call `npm install` with default lifecycle execution"),
    bullet("Hardcoded secret-like literals and credential patterns"),
    "",
    "## Executed Commands",
    "```text",
    ...report.commands.map((entry) => `${entry.command}`),
    "```",
    "",
    "## Output Summary",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    `| Full dependency audit | ${statusLine(auditAllCheck?.passed)} | ${auditAll?.details.summary} |`,
    `| Production dependency audit | ${statusLine(auditProdCheck?.passed)} | ${auditProd?.details.summary} |`,
    `| Lifecycle hooks | ${statusLine(lifecycle.length === 0)} | ${lifecycle.length} manifest hooks found |`,
    `| Dependency install scripts | ${installScriptStatus} | ${installScripts.length > 0 ? `${installScripts.length} packages flagged in lockfile` : `${acceptedInstallScripts.length} accepted transitive install-script packages` } |`,
    `| npm install defaults | ${statusLine(npmInstallDefaults.length === 0)} | ${npmInstallDefaults.length} executable files use default install behavior |`,
    `| Secret-like patterns | ${statusLine(secretScanCheck?.passed)} | ${secrets.length} findings |`,
    "",
    "## Dependency Audit Details",
    `- Full audit exit code: ${auditAll?.exitCode ?? "n/a"}`,
    `- Production audit exit code: ${auditProd?.exitCode ?? "n/a"}`,
    `- Full audit vulnerabilities: critical=${auditAll?.details.counts.critical ?? 0}, high=${auditAll?.details.counts.high ?? 0}, moderate=${auditAll?.details.counts.moderate ?? 0}, low=${auditAll?.details.counts.low ?? 0}, info=${auditAll?.details.counts.info ?? 0}, total=${auditAll?.details.counts.total ?? 0}`,
    `- Production audit vulnerabilities: critical=${auditProd?.details.counts.critical ?? 0}, high=${auditProd?.details.counts.high ?? 0}, moderate=${auditProd?.details.counts.moderate ?? 0}, low=${auditProd?.details.counts.low ?? 0}, info=${auditProd?.details.counts.info ?? 0}, total=${auditProd?.details.counts.total ?? 0}`,
    "",
    "## Script and Lockfile Risks",
    ...lifecycle.slice(0, 10).map((entry) => bullet(`${entry.file} defines lifecycle hook \`${entry.hook}\``)),
    ...installScripts.slice(0, 10).map((entry) => bullet(`package-lock entry \`${entry.package}\` hasInstallScript=true`)),
    ...npmInstallDefaults.slice(0, 10).map((entry) => bullet(`${entry.file}:${entry.line} uses \`${entry.command}\``)),
    lifecycle.length + installScripts.length + npmInstallDefaults.length === 0 ? [bullet("No script-default risks found.")] : [],
    "",
    "## Accepted Dependency Install Scripts",
    acceptedInstallScripts.length === 0
      ? [bullet("No accepted transitive install-script packages were detected.")]
      : [
          bullet("These packages retain install scripts by design and are accepted because the build now uses `npm ci` rather than default `npm install`."),
          ...acceptedInstallScripts.slice(0, 10).map((entry) => bullet(`package-lock entry \`${entry.package}\` hasInstallScript=true${entry.optional ? " (optional)" : ""}`))
        ],
    "",
    "## Secret Scan Details",
    secrets.length === 0
      ? [bullet("No hardcoded secret-like literals were found in the scanned source and config files.")]
      : secrets.slice(0, 10).map((entry) =>
          bullet(`${entry.file}:${entry.line} matched \`${entry.kind === "hardcoded_secret_pattern" ? entry.pattern : entry.kind}\``)
        ),
    "",
    "## Machine-Readable Output",
    "The JSON report is emitted on stdout by `node tools/scripts/vuln-scan-dependencies.mjs` and includes the command results, findings, and summary counts.",
    "",
    "## Status",
    `Overall scan result: **${report.summary.status}**`,
    ""
  ].flat().join("\n");
};

const run = async () => {
  const auditAllRaw = runCommand("npm", ["audit", "--json"]);
  const auditProdRaw = runCommand("npm", ["audit", "--omit=dev", "--json"]);

  const auditAllJson = parseJsonMaybe(auditAllRaw.stdout);
  const auditProdJson = parseJsonMaybe(auditProdRaw.stdout);

  const auditAll = summarizeAuditResult(auditAllJson ?? {});
  const auditProd = summarizeAuditResult(auditProdJson ?? {});
  const lifecycleFindings = await scanPackageManifests();
  const { findings: installScriptFindings, acceptedFindings: acceptedInstallScriptFindings } = await scanLockfileInstallScripts();
  const npmInstallDefaults = await scanNpmInstallDefaults();
  const secretFindings = await scanSecrets();

  const commands = [
    {
      id: "npm_audit_all",
      command: "npm audit --json",
      cwd: ".",
      exitCode: auditAllRaw.exitCode,
      durationMs: auditAllRaw.durationMs,
      details: {
        summary: `dependencies=${auditAll.dependencyCount}, vulnerabilities=${auditAll.vulnerabilityCounts.total}, critical=${auditAll.vulnerabilityCounts.critical}, high=${auditAll.vulnerabilityCounts.high}, moderate=${auditAll.vulnerabilityCounts.moderate}, low=${auditAll.vulnerabilityCounts.low}, info=${auditAll.vulnerabilityCounts.info}`,
        counts: auditAll.vulnerabilityCounts,
        topFindings: auditAll.topFindings,
        stdoutBytes: auditAllRaw.stdout.length,
        stderrBytes: auditAllRaw.stderr.length,
        stdoutParseable: auditAllJson !== null
      }
    },
    {
      id: "npm_audit_prod",
      command: "npm audit --omit=dev --json",
      cwd: ".",
      exitCode: auditProdRaw.exitCode,
      durationMs: auditProdRaw.durationMs,
      details: {
        summary: `dependencies=${auditProd.dependencyCount}, vulnerabilities=${auditProd.vulnerabilityCounts.total}, critical=${auditProd.vulnerabilityCounts.critical}, high=${auditProd.vulnerabilityCounts.high}, moderate=${auditProd.vulnerabilityCounts.moderate}, low=${auditProd.vulnerabilityCounts.low}, info=${auditProd.vulnerabilityCounts.info}`,
        counts: auditProd.vulnerabilityCounts,
        topFindings: auditProd.topFindings,
        stdoutBytes: auditProdRaw.stdout.length,
        stderrBytes: auditProdRaw.stderr.length,
        stdoutParseable: auditProdJson !== null
      }
    }
  ];

  const findings = [
    ...lifecycleFindings,
    ...installScriptFindings,
    ...npmInstallDefaults,
    ...secretFindings
  ];

  const checks = [
    {
      checkId: "full_dependency_audit",
      passed: auditAll.vulnerabilityCounts.total === 0,
      details: {
        command: "npm audit --json",
        exitCode: auditAllRaw.exitCode,
        counts: auditAll.vulnerabilityCounts,
        topFindings: auditAll.topFindings
      }
    },
    {
      checkId: "production_dependency_audit",
      passed: auditProd.vulnerabilityCounts.total === 0,
      details: {
        command: "npm audit --omit=dev --json",
        exitCode: auditProdRaw.exitCode,
        counts: auditProd.vulnerabilityCounts,
        topFindings: auditProd.topFindings
      }
    },
    {
      checkId: "script_default_risk",
      passed: lifecycleFindings.length === 0 && installScriptFindings.length === 0 && npmInstallDefaults.length === 0,
      details: {
        lifecycleHooks: lifecycleFindings.length,
        dependencyInstallScripts: installScriptFindings.length,
        npmInstallDefaults: npmInstallDefaults.length
      }
    },
    {
      checkId: "hardcoded_secret_scan",
      passed: secretFindings.length === 0,
      details: {
        findings: secretFindings.length
      }
    }
  ];

  const passedChecks = checks.filter((check) => check.passed).length;
  const report = {
    generatedAt: new Date().toISOString(),
    suite: "dependency-and-secrets-risk-scan",
    repoRoot: repoRoot.replace(/\\/g, "/"),
    commands,
    checks,
    findings,
    acceptedDependencyInstallScripts: acceptedInstallScriptFindings,
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      status: checks.every((check) => check.passed) ? "PASS" : "FAIL",
      audit: {
        full: auditAll.vulnerabilityCounts,
        production: auditProd.vulnerabilityCounts
      },
      riskCounts: {
        lifecycleHooks: lifecycleFindings.length,
        dependencyInstallScripts: installScriptFindings.length,
        acceptedDependencyInstallScripts: acceptedInstallScriptFindings.length,
        npmInstallDefaults: npmInstallDefaults.length,
        secretFindings: secretFindings.length
      }
    }
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${renderMarkdownReport(report)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));

  if (report.summary.status !== "PASS") {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
