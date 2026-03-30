#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const commandPlan = [
  { id: "typecheck", label: "Typecheck", command: "run typecheck", weight: 8, mandatory: true },
  { id: "build", label: "Build", command: "run build", weight: 8, mandatory: true },
  { id: "test", label: "Test", command: "run test", weight: 12, mandatory: true },
  { id: "test-surface", label: "Test Surface Validation", command: "run validate:test-surface", weight: 6, mandatory: true },
  { id: "infra", label: "Infra Validation", command: "run validate:infra", weight: 6, mandatory: true },
  { id: "smoke", label: "Smoke Pilot", command: "run smoke:pilot", weight: 8, mandatory: true },
  { id: "proof", label: "Commercial Proof", command: "run proof:commercial", weight: 8, mandatory: true },
  { id: "trust-proof", label: "Trust Layer Proof", command: "run proof:trust-layer", weight: 8, mandatory: true },
  { id: "codebase-audit", label: "Codebase Line Audit", command: "run audit:codebase", weight: 6, mandatory: true },
  { id: "commercial-audit", label: "Commercial Audit", command: "run audit:commercial", weight: 6, mandatory: true },
  { id: "load", label: "Commercial Load", command: "run load:commercial", weight: 5, mandatory: true },
  { id: "chaos", label: "Commercial Chaos", command: "run chaos:commercial", weight: 5, mandatory: true },
  { id: "backup", label: "Backup State", command: "run backup:state", weight: 6, mandatory: true },
  { id: "restore", label: "Restore State", command: "run restore:state -- latest", weight: 6, mandatory: true }
];

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
};

const runCommand = (command) =>
  new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(`${npmExecutable} ${command}`, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000)
      });
    });
  });

export const computeReadinessScore = (input) => {
  const commandContribution = input.commands.reduce((sum, command) => {
    if (command.status === "PASS") return sum + command.weight;
    return sum;
  }, 0);
  const commandMax = input.commands.reduce((sum, command) => sum + command.weight, 0);

  const weightedSignal =
    (input.signals.proofScorePercent / 100) * 15 +
    (input.signals.loadScorePercent / 100) * 10 +
    (input.signals.chaosScorePercent / 100) * 10;
  const weightedSignalMax = 35;

  const rawScore = commandContribution + weightedSignal;
  const maxScore = Math.max(1, commandMax + weightedSignalMax);
  const scorePercent = Number(((rawScore / maxScore) * 100).toFixed(2));
  const mandatoryFailed = input.commands.some((command) => command.mandatory && command.status !== "PASS");
  const pass = !mandatoryFailed && scorePercent >= 98;

  return {
    scorePercent,
    pass,
    rawScore: Number(rawScore.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    commandContribution,
    weightedSignal,
    mandatoryFailed
  };
};

export const runReadinessGate = async () => {
  const commandResults = [];

  for (const plan of commandPlan) {
    const result = await runCommand(plan.command);
    const status = result.code === 0 ? "PASS" : "FAIL";
    commandResults.push({
      id: plan.id,
      label: plan.label,
      mandatory: plan.mandatory,
      weight: plan.weight,
      status,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail
    });

    if (status !== "PASS" && plan.mandatory) {
      break;
    }
  }

  const proofReport = await readJson("docs/assets/demo/commercial-proof-report.json", { summary: { scorePercent: 0, status: "FAIL" } });
  const loadReport = await readJson("docs/assets/demo/load-test-report.json", { scorePercent: 0, status: "FAIL" });
  const chaosReport = await readJson("docs/assets/demo/chaos-report.json", { summary: { scorePercent: 0, status: "FAIL" } });

  const scoringInput = {
    commands: commandResults,
    signals: {
      proofScorePercent: Number(proofReport?.summary?.scorePercent ?? 0),
      loadScorePercent: Number(loadReport?.scorePercent ?? 0),
      chaosScorePercent: Number(chaosReport?.summary?.scorePercent ?? 0)
    }
  };

  const computed = computeReadinessScore(scoringInput);

  const report = {
    generatedAt: new Date().toISOString(),
    targetReadinessPercent: 98,
    commands: commandResults,
    signals: {
      commercialProof: {
        scorePercent: scoringInput.signals.proofScorePercent,
        status: proofReport?.summary?.status ?? "UNKNOWN"
      },
      loadTest: {
        scorePercent: scoringInput.signals.loadScorePercent,
        status: loadReport?.status ?? "UNKNOWN"
      },
      chaosDrill: {
        scorePercent: scoringInput.signals.chaosScorePercent,
        status: chaosReport?.summary?.status ?? "UNKNOWN"
      }
    },
    summary: {
      ...computed,
      status: computed.pass ? "PASS" : "FAIL"
    }
  };

  await mkdir(resolve("docs", "assets", "demo"), { recursive: true });
  await writeFile(resolve("docs/assets/demo/readiness-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const evidenceResult = await runCommand("run evidence:package");
  report.commands.push({
    id: "evidence",
    label: "Export Evidence Package",
    mandatory: true,
    weight: 5,
    status: evidenceResult.code === 0 ? "PASS" : "FAIL",
    exitCode: evidenceResult.code,
    durationMs: evidenceResult.durationMs,
    stdoutTail: evidenceResult.stdoutTail,
    stderrTail: evidenceResult.stderrTail
  });

  const finalComputed = computeReadinessScore({
    commands: report.commands,
    signals: scoringInput.signals
  });
  report.summary = {
    ...finalComputed,
    status: finalComputed.pass ? "PASS" : "FAIL"
  };
  await writeFile(resolve("docs/assets/demo/readiness-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return report;
};

if ((process.argv[1] ?? "").replace(/\\/g, "/").endsWith("/tools/scripts/readiness-gate.mjs")) {
  runReadinessGate()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.summary.status !== "PASS") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
