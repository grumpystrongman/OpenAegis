#!/usr/bin/env node
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createAppServer as createAuditServer } from "../../backend/services/audit-ledger/src/index.ts";
import { createAppServer as createKillSwitchServer } from "../../backend/services/kill-switch-service/src/index.ts";

const ports = {
  audit: Number(process.env.OPENAEGIS_CHAOS_AUDIT_PORT ?? 3931),
  auditRestart: Number(process.env.OPENAEGIS_CHAOS_AUDIT_RESTART_PORT ?? 3933),
  killSwitch: Number(process.env.OPENAEGIS_CHAOS_KILL_SWITCH_PORT ?? 3932)
};

const baseUrls = {
  audit: `http://127.0.0.1:${ports.audit}`,
  auditRestart: `http://127.0.0.1:${ports.auditRestart}`,
  killSwitch: `http://127.0.0.1:${ports.killSwitch}`
};

const auditHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "auditor,security_admin"
};

const killHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,platform_admin"
};

const callJson = async (url, method, headers, body) => {
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const startServer = async (server, port) => {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(undefined);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
};

const stopServer = async (server) => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
};

export const runCommercialChaos = async () => {
  await rm(".volumes/audit-ledger-state.json", { force: true });
  await rm(".volumes/kill-switch-service-state.json", { force: true });

  const auditServer = createAuditServer();
  const killSwitchServer = createKillSwitchServer();
  let activeAuditServer = auditServer;
  const checks = [];

  try {
    await Promise.all([startServer(auditServer, ports.audit), startServer(killSwitchServer, ports.killSwitch)]);

    for (let index = 0; index < 10; index += 1) {
      const result = await callJson(`${baseUrls.audit}/v1/audit/evidence`, "POST", auditHeaders, {
        evidenceId: `chaos-ev-${index + 1}`,
        executionId: `chaos-ex-001`,
        dataSources: ["fhir", "sql"],
        policyIds: ["policy-allow"],
        outputClassification: "EPHI",
        blocked: false,
        finalDisposition: "completed"
      });
      if (result.status !== 201) throw new Error("audit_write_failed");
    }

    const verifyBeforeRestart = await callJson(`${baseUrls.audit}/v1/audit/verify-chain`, "GET", auditHeaders);
    checks.push({
      checkId: "audit_chain_valid_before_restart",
      passed: verifyBeforeRestart.status === 200 && verifyBeforeRestart.payload.valid === true,
      details: verifyBeforeRestart.payload
    });

    await stopServer(auditServer);
    const auditServerRestarted = createAuditServer();
    activeAuditServer = auditServerRestarted;
    await startServer(auditServerRestarted, ports.auditRestart);

    const listAfterRestart = await callJson(`${baseUrls.auditRestart}/v1/audit/evidence`, "GET", auditHeaders);
    checks.push({
      checkId: "audit_entries_persist_after_restart",
      passed:
        listAfterRestart.status === 200 &&
        Array.isArray(listAfterRestart.payload.entries) &&
        listAfterRestart.payload.entries.length >= 10,
      details: { entries: listAfterRestart.payload.entries?.length ?? 0 }
    });

    const verifyAfterRestart = await callJson(`${baseUrls.auditRestart}/v1/audit/verify-chain`, "GET", auditHeaders);
    checks.push({
      checkId: "audit_chain_valid_after_restart",
      passed: verifyAfterRestart.status === 200 && verifyAfterRestart.payload.valid === true,
      details: verifyAfterRestart.payload
    });

    await stopServer(auditServerRestarted);

    const trigger = await callJson(`${baseUrls.killSwitch}/v1/kill-switch/trigger`, "POST", killHeaders, {
      tenantId: "tenant-starlight-health",
      workflowId: "wf-discharge-assistant",
      serviceName: "tool-execution-service",
      reason: "chaos drill forced isolation",
      severity: "critical"
    });

    checks.push({
      checkId: "kill_switch_trigger",
      passed: trigger.status === 201 || trigger.status === 200,
      details: trigger.payload
    });

    const release = await callJson(`${baseUrls.killSwitch}/v1/kill-switch/release`, "POST", killHeaders, {
      circuitId: trigger.payload?.circuit?.circuitId,
      reason: "chaos drill release"
    });

    checks.push({
      checkId: "kill_switch_release",
      passed: release.status === 200 && release.payload?.circuit?.status === "released",
      details: release.payload
    });

    const eventList = await callJson(`${baseUrls.killSwitch}/v1/kill-switch/events`, "GET", killHeaders);
    checks.push({
      checkId: "kill_switch_event_chain_valid",
      passed:
        eventList.status === 200 &&
        eventList.payload?.chainVerification?.valid === true &&
        Array.isArray(eventList.payload?.events) &&
        eventList.payload.events.length >= 2,
      details: {
        eventCount: eventList.payload?.events?.length ?? 0,
        chain: eventList.payload?.chainVerification
      }
    });

    const passedChecks = checks.filter((check) => check.passed).length;
    const scorePercent = Math.round((passedChecks / checks.length) * 100);
    const report = {
      generatedAt: new Date().toISOString(),
      suite: "commercial-chaos-drill",
      endpoints: baseUrls,
      checks,
      summary: {
        totalChecks: checks.length,
        passedChecks,
        failedChecks: checks.length - passedChecks,
        scorePercent,
        status: scorePercent >= 98 ? "PASS" : "FAIL"
      }
    };

    await mkdir("docs/assets/demo", { recursive: true });
    await writeFile("docs/assets/demo/chaos-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    await Promise.all([stopServer(killSwitchServer).catch(() => {}), stopServer(activeAuditServer).catch(() => {})]);
  }
};

if ((process.argv[1] ?? "").replace(/\\/g, "/").endsWith("/tools/scripts/chaos-commercial.mjs")) {
  runCommercialChaos()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.summary.status !== "PASS") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
