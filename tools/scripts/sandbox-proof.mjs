#!/usr/bin/env node
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAppServer } from "../../dist/services/api-gateway/src/index.js";
import {
  composeDown,
  composePs,
  composeUp,
  detectDockerRuntime,
  dockerVersion,
  formatError,
  loadSandboxCatalog,
  proofReportPath,
  validateCompose,
  waitForHttpProbe,
  writeJsonReport
} from "./sandbox-lib.mjs";

const port = Number(process.env.OPENAEGIS_SANDBOX_PROOF_PORT ?? 3970);
const baseUrl = `http://127.0.0.1:${port}`;

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const hasExecutionShape = (execution, workflowId) =>
  Boolean(
    execution &&
      typeof execution.executionId === "string" &&
      execution.executionId.length > 0 &&
      execution.workflowId === workflowId &&
      typeof execution.status === "string"
  );

const authenticate = async () => {
  const [clinician, security, admin] = await Promise.all([
    request("/v1/auth/login", { method: "POST", body: { email: "clinician@starlighthealth.org" } }),
    request("/v1/auth/login", { method: "POST", body: { email: "security@starlighthealth.org" } }),
    request("/v1/auth/login", { method: "POST", body: { email: "admin@starlighthealth.org" } })
  ]);

  if (clinician.status !== 200 || security.status !== 200 || admin.status !== 200) {
    throw new Error("sandbox_proof_demo_authentication_failed");
  }

  return {
    clinician: clinician.payload.accessToken,
    security: security.payload.accessToken,
    admin: admin.payload.accessToken
  };
};

const workflowProofForSandbox = async (sandbox, tokens) => {
  const steps = [];
  const authHeaders = (token) => ({ authorization: `Bearer ${token}` });

  const packRead = await request(`/v1/projects/packs/${sandbox.packId}`, {
    headers: authHeaders(tokens.admin)
  });
  steps.push({
    step: "read_pack",
    status: packRead.status,
    passed: packRead.status === 200,
    details: { workflowId: packRead.payload.workflowId, connectors: packRead.payload.connectors?.length ?? 0 }
  });

  const experience = await request(`/v1/projects/packs/${sandbox.packId}/experience`, {
    headers: authHeaders(tokens.admin)
  });
  steps.push({
    step: "load_experience",
    status: experience.status,
    passed: experience.status === 200,
    details: {
      dataTables: experience.payload.experience?.dataTables?.length ?? 0,
      trustChecks: experience.payload.experience?.trustChecks?.length ?? 0
    }
  });

  const settings = await request(`/v1/projects/packs/${sandbox.packId}/settings`, {
    headers: authHeaders(tokens.admin)
  });
  steps.push({
    step: "load_settings",
    status: settings.status,
    passed: settings.status === 200,
    details: {
      checklistItems: settings.payload.settingsChecklist?.items?.length ?? 0,
      preset: settings.payload.policyPreset?.profileName ?? null
    }
  });

  const applyPreset = await request(`/v1/projects/packs/${sandbox.packId}/policies/apply`, {
    method: "POST",
    headers: authHeaders(tokens.security),
    body: {}
  });
  steps.push({
    step: "apply_policy_preset",
    status: applyPreset.status,
    passed: applyPreset.status === 200,
    details: {
      profileName: applyPreset.payload.result?.profile?.profileName ?? null,
      profileVersion: applyPreset.payload.result?.profile?.profileVersion ?? null
    }
  });

  const simulationRun = await request(`/v1/projects/packs/${sandbox.packId}/run`, {
    method: "POST",
    headers: authHeaders(tokens.admin),
    body: {
      mode: "simulation",
      requestFollowupEmail: false,
      zeroRetentionRequested: true
    }
  });
  steps.push({
    step: "run_simulation",
    status: simulationRun.status,
    passed:
      simulationRun.status === 201 &&
      hasExecutionShape(simulationRun.payload.execution, simulationRun.payload.pack?.workflowId),
    details: {
      executionId: simulationRun.payload.execution?.executionId ?? null,
      workflowId: simulationRun.payload.execution?.workflowId ?? null,
      executionStatus: simulationRun.payload.execution?.status ?? null
    }
  });

  const liveRun = await request(`/v1/projects/packs/${sandbox.packId}/run`, {
    method: "POST",
    headers: authHeaders(tokens.admin),
    body: {
      mode: "live",
      requestFollowupEmail: false,
      zeroRetentionRequested: true
    }
  });

  const approvalId = liveRun.payload.execution?.approvalId ?? null;
  steps.push({
    step: "run_live",
    status: liveRun.status,
    passed:
      liveRun.status === 201 &&
      hasExecutionShape(liveRun.payload.execution, liveRun.payload.pack?.workflowId),
    details: {
      executionId: liveRun.payload.execution?.executionId ?? null,
      executionStatus: liveRun.payload.execution?.status ?? null,
      approvalId
    }
  });

  let approvalDecision = { status: null, payload: {} };
  let finalExecution = { status: null, payload: {} };
  let graph = { status: null, payload: {} };
  let audit = { status: null, payload: {} };

  if (approvalId) {
    approvalDecision = await request(`/v1/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: authHeaders(tokens.security),
      body: { decision: "approve", reason: `sandbox proof approval for ${sandbox.packId}` }
    });

    finalExecution = await request(`/v1/executions/${liveRun.payload.execution?.executionId}`, {
      headers: authHeaders(tokens.admin)
    });

    graph = await request(`/v1/executions/${liveRun.payload.execution?.executionId}/graph`, {
      headers: authHeaders(tokens.admin)
    });

    audit = await request("/v1/audit/events", {
      headers: authHeaders(tokens.security)
    });
  }

  const graphStages = graph.payload.graphExecution?.steps?.map((step) => step.stage) ?? [];
  steps.push({
    step: "approve_and_verify",
    status: approvalDecision.status,
    passed:
      approvalId
        ? approvalDecision.status === 200 &&
          approvalDecision.payload.status === "approved" &&
          finalExecution.status === 200 &&
          typeof finalExecution.payload.status === "string" &&
          graph.status === 200 &&
          Array.isArray(graphStages) &&
          graphStages.length > 0 &&
          audit.status === 200 &&
          Array.isArray(audit.payload.events) &&
          audit.payload.events.length > 0
        : true,
    details: {
      approvalRequired: Boolean(approvalId),
      approvalStatus: approvalDecision.payload.status ?? null,
      finalExecutionStatus: finalExecution.payload.status ?? liveRun.payload.execution?.status ?? null,
      graphStages,
      auditEvents: audit.payload.events?.length ?? 0
    }
  });

  const passed = steps.every((step) => step.passed);
  return {
    passed,
    steps,
    executionId: liveRun.payload.execution?.executionId ?? simulationRun.payload.execution?.executionId ?? null,
    workflowId: packRead.payload.workflowId ?? null
  };
};

const probeSandboxServices = async (sandbox, runtime) => {
  const probes = [];
  for (const probe of sandbox.serviceProbes ?? []) {
    const startedAt = Date.now();
    const result = await waitForHttpProbe(probe, { runtime });
    probes.push({
      serviceId: probe.serviceId,
      name: probe.name,
      passed: result.ok,
      url: result.url,
      httpStatus: result.httpStatus,
      elapsedMs: Date.now() - startedAt,
      bodyPreview: result.bodyPreview,
      error: result.error
    });
  }
  return probes;
};

export const runSandboxProof = async () => {
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "true";
  await rm(".volumes/pilot-state.json", { force: true });

  const server = createAppServer();
  server.listen(port);
  await once(server, "listening");

  const report = {
    generatedAt: new Date().toISOString(),
    reportPath: proofReportPath,
    docker: {
      cliAvailable: false,
      daemonAvailable: false,
      error: null,
      details: null
    },
    openaegis: {
      baseUrl,
      workflowServerStarted: true
    },
    sandboxes: [],
    summary: {
      totalSandboxes: 0,
      passedSandboxes: 0,
      failedSandboxes: 0,
      status: "FAIL"
    }
  };

  try {
    const sandboxes = await loadSandboxCatalog();
    const tokens = await authenticate();
    const docker = await dockerVersion();
    const dockerRuntime = await detectDockerRuntime();
    report.docker = docker;

    for (const sandbox of sandboxes) {
      const sandboxResult = {
        id: sandbox.id,
        name: sandbox.name,
        packId: sandbox.packId,
        composeFile: sandbox.composeFile,
        composeValidation: await validateCompose(sandbox),
        composeStart: null,
        composePs: null,
        composeDown: null,
        serviceProbes: [],
        workflowProof: null,
        passed: false
      };

      let started = false;
      try {
        if (docker.daemonAvailable) {
          sandboxResult.composeStart = await composeUp(sandbox);
          started = sandboxResult.composeStart.ok;
          sandboxResult.composePs = await composePs(sandbox);
          if (started) {
            sandboxResult.serviceProbes = await probeSandboxServices(sandbox, dockerRuntime);
          }
        } else {
          sandboxResult.composeStart = {
            ok: false,
            exitCode: null,
            elapsedMs: 0,
            stderr: docker.error ?? "docker_daemon_unavailable",
            stdout: "",
            command: "docker compose up -d --remove-orphans"
          };
        }

        sandboxResult.workflowProof = await workflowProofForSandbox(sandbox, tokens);
      } finally {
        if (started) {
          sandboxResult.composeDown = await composeDown(sandbox);
        }
      }

      const composePassed = sandboxResult.composeValidation.ok && sandboxResult.composeStart?.ok === true;
      const probesPassed = sandboxResult.serviceProbes.length > 0 && sandboxResult.serviceProbes.every((probe) => probe.passed);
      const workflowPassed = sandboxResult.workflowProof?.passed === true;
      sandboxResult.passed = composePassed && probesPassed && workflowPassed;
      report.sandboxes.push(sandboxResult);
    }

    report.summary.totalSandboxes = report.sandboxes.length;
    report.summary.passedSandboxes = report.sandboxes.filter((sandbox) => sandbox.passed).length;
    report.summary.failedSandboxes = report.summary.totalSandboxes - report.summary.passedSandboxes;
    report.summary.status = report.summary.failedSandboxes === 0 ? "PASS" : "FAIL";

    await writeJsonReport(proofReportPath, report);

    if (!docker.daemonAvailable) {
      throw new Error(
        `docker_daemon_unavailable:${docker.error ?? "Docker CLI found but the daemon could not be reached."}`
      );
    }
    if (report.summary.status !== "PASS") {
      throw new Error("sandbox_connectivity_proof_failed");
    }

    return report;
  } finally {
    server.close();
    await once(server, "close");
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSandboxProof()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(formatError(error));
      process.exitCode = 1;
    });
}
