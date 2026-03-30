#!/usr/bin/env node
import { spawn } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const commands = [
  { id: "readiness", label: "Run readiness gate", args: ["run", "readiness:gate"] },
  { id: "kpis", label: "Build design-partner KPI report", args: ["run", "pilot:kpis"] },
  { id: "evidence", label: "Publish security evidence pack", args: ["run", "evidence:security-pack"] }
];

const runCommand = (args) =>
  new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(`${npmExecutable} ${args.join(" ")}`, [], { stdio: "inherit", shell: true });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, durationMs: Date.now() - startedAt }));
  });

const run = async () => {
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command.args);
    results.push({
      id: command.id,
      label: command.label,
      exitCode: result.code,
      durationMs: result.durationMs,
      status: result.code === 0 ? "PASS" : "FAIL"
    });
    if (result.code !== 0) break;
  }

  const failed = results.find((result) => result.status !== "PASS");
  const output = {
    generatedAt: new Date().toISOString(),
    suite: "local-pilot-one-command",
    commands: results,
    summary: {
      total: commands.length,
      passed: results.filter((result) => result.status === "PASS").length,
      failed: failed ? 1 : 0,
      status: failed ? "FAIL" : "PASS"
    },
    outputs: {
      readinessGate: "docs/assets/demo/readiness-gate-report.json",
      designPartnerKpis: "docs/assets/demo/design-partner-kpis.json",
      securityEvidencePackPointer: "docs/assets/security-evidence-pack/latest.json"
    }
  };

  console.log(JSON.stringify(output, null, 2));
  if (failed) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
