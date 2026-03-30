#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const commandPlan = [
  { id: "trust-proof", label: "Run trust proof", args: ["run", "proof:trust-layer"] },
  { id: "design-partner-kpis", label: "Generate design-partner KPIs", args: ["run", "pilot:kpis"] },
  { id: "security-evidence-pack", label: "Publish security evidence pack", args: ["run", "evidence:security-pack"] }
];

const runCommand = (args) =>
  new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(`${npmExecutable} ${args.join(" ")}`, [], { stdio: "inherit", shell: true });
    child.on("close", (code) =>
      resolvePromise({
        code: code ?? 1,
        durationMs: Date.now() - startedAt
      })
    );
  });

const run = async () => {
  const startedAt = new Date();
  const completedAt = new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const commandResults = [];

  for (const command of commandPlan) {
    const result = await runCommand(command.args);
    commandResults.push({
      id: command.id,
      label: command.label,
      status: result.code === 0 ? "PASS" : "FAIL",
      exitCode: result.code,
      durationMs: result.durationMs
    });
    if (result.code !== 0) break;
  }

  const failed = commandResults.some((result) => result.status !== "PASS");
  const report = {
    generatedAt: new Date().toISOString(),
    suite: "trust-proof-challenge-launch",
    challengeWindow: {
      startDate: startedAt.toISOString().slice(0, 10),
      endDate: completedAt.toISOString().slice(0, 10),
      durationDays: 14
    },
    commands: commandResults,
    outputs: {
      challengeGuide: "docs/challenge/TRUST-PROOF-CHALLENGE-14-DAY.md",
      trustProof: "docs/assets/demo/trust-layer-proof-report.json",
      designPartnerKpis: "docs/assets/demo/design-partner-kpis.json",
      securityEvidencePackPointer: "docs/assets/security-evidence-pack/latest.json"
    },
    summary: {
      status: failed ? "FAIL" : "PASS",
      message: failed
        ? "Challenge launch blocked. Fix failing command and relaunch."
        : "Challenge launch successful. Share the challenge guide and evidence artifacts."
    }
  };

  await mkdir(resolve("docs", "assets", "challenge"), { recursive: true });
  await writeFile(resolve("docs/assets/challenge/trust-proof-challenge-launch.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
