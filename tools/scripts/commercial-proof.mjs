#!/usr/bin/env node
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAppServer as createGatewayServer } from "../../dist/services/api-gateway/src/index.js";
import { createAppServer as createToolRegistryServer } from "../../dist/services/tool-registry/src/index.js";
import { createAppServer as createToolExecutionServer } from "../../dist/services/tool-execution-service/src/index.js";

const ports = {
  gateway: Number(process.env.OPENAEGIS_PROOF_GATEWAY_PORT ?? 3920),
  toolRegistry: Number(process.env.OPENAEGIS_PROOF_TOOL_REGISTRY_PORT ?? 3921),
  toolExecution: Number(process.env.OPENAEGIS_PROOF_TOOL_EXECUTION_PORT ?? 3922)
};

const baseUrls = {
  gateway: `http://127.0.0.1:${ports.gateway}`,
  toolRegistry: `http://127.0.0.1:${ports.toolRegistry}`,
  toolExecution: `http://127.0.0.1:${ports.toolExecution}`
};

const call = async (baseUrl, path, method = "GET", options = {}) => {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const makeClaim = (input) => ({
  claimId: input.claimId,
  title: input.title,
  passed: Boolean(input.passed),
  whyItMatters: input.whyItMatters,
  howTested: input.howTested,
  evidence: input.evidence
});

export const runCommercialProof = async () => {
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "true";
  await rm(".volumes/pilot-state.json", { force: true });
  await rm(".volumes/tool-registry-state.json", { force: true });
  await rm(".volumes/tool-execution-state.json", { force: true });

  const servers = {
    gateway: createGatewayServer(),
    toolRegistry: createToolRegistryServer(),
    toolExecution: createToolExecutionServer()
  };

  servers.gateway.listen(ports.gateway);
  servers.toolRegistry.listen(ports.toolRegistry);
  servers.toolExecution.listen(ports.toolExecution);
  await Promise.all([
    once(servers.gateway, "listening"),
    once(servers.toolRegistry, "listening"),
    once(servers.toolExecution, "listening")
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    profile: "commercial-readiness",
    scope: {
      product: "OpenAegis",
      scenario: "Hospital Discharge Readiness Assistant",
      environment: "local-pilot"
    },
    commands: [
      "npm run build",
      "npm run proof:commercial",
      "npm run smoke:pilot",
      "node tools/scripts/pilot-demo.mjs"
    ],
    endpoints: baseUrls,
    claims: [],
    summary: {
      totalClaims: 0,
      passedClaims: 0,
      failedClaims: 0,
      score: 0,
      scorePercent: 0,
      status: "FAIL"
    },
    checks: []
  };

  try {
    const clinicianLogin = await call(baseUrls.gateway, "/v1/auth/login", "POST", {
      body: { email: "clinician@starlighthealth.org" }
    });
    const approverLogin = await call(baseUrls.gateway, "/v1/auth/login", "POST", {
      body: { email: "security@starlighthealth.org" }
    });

    if (clinicianLogin.status !== 200 || approverLogin.status !== 200) {
      throw new Error("unable_to_authenticate_demo_users");
    }

    const clinicianToken = clinicianLogin.payload.accessToken;
    const approverToken = approverLogin.payload.accessToken;

    const liveExecution = await call(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: `Bearer ${clinicianToken}` },
      body: {
        mode: "live",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        requestFollowupEmail: true
      }
    });

    const policyGateClaim = makeClaim({
      claimId: "policy_gate_enforced",
      title: "Policy gate blocks high-risk live path before completion",
      passed:
        liveExecution.status === 201 &&
        liveExecution.payload.status === "blocked" &&
        typeof liveExecution.payload.approvalId === "string",
      whyItMatters: "Prevents unsafe autonomous execution on sensitive actions.",
      howTested: "Run live discharge workflow and assert blocked state with approval ticket.",
      evidence: {
        executionId: liveExecution.payload.executionId,
        approvalId: liveExecution.payload.approvalId,
        status: liveExecution.payload.status
      }
    });

    const approvalDecision = await call(
      baseUrls.gateway,
      `/v1/approvals/${liveExecution.payload.approvalId}/decide`,
      "POST",
      {
        headers: { authorization: `Bearer ${approverToken}` },
        body: { decision: "approve", reason: "commercial proof harness approval" }
      }
    );

    const executionAfterApproval = await call(
      baseUrls.gateway,
      `/v1/executions/${liveExecution.payload.executionId}`,
      "GET",
      {
        headers: { authorization: `Bearer ${clinicianToken}` }
      }
    );

    const approvalClaim = makeClaim({
      claimId: "human_approval_control",
      title: "Human approval unlocks workflow continuation",
      passed:
        approvalDecision.status === 200 &&
        approvalDecision.payload.status === "approved" &&
        executionAfterApproval.status === 200 &&
        executionAfterApproval.payload.status === "completed",
      whyItMatters: "Demonstrates governance without disabling automation entirely.",
      howTested: "Approve pending ticket and verify workflow transitions to completed.",
      evidence: {
        approvalStatus: approvalDecision.payload.status,
        executionStatusAfterApproval: executionAfterApproval.payload.status,
        evidenceId: executionAfterApproval.payload.evidenceId
      }
    });

    const graphCheck = await call(
      baseUrls.gateway,
      `/v1/executions/${liveExecution.payload.executionId}/graph`,
      "GET",
      {
        headers: { authorization: `Bearer ${clinicianToken}` }
      }
    );

    const graphStages = graphCheck.payload.graphExecution?.steps?.map((step) => step.stage) ?? [];
    const graphClaim = makeClaim({
      claimId: "deterministic_graph_checkpoints",
      title: "Execution graph remains deterministic and replayable",
      passed:
        graphCheck.status === 200 &&
        graphCheck.payload.graphExecution?.status === "completed" &&
        JSON.stringify(graphStages) === JSON.stringify(["planner", "executor", "reviewer"]),
      whyItMatters: "Allows post-incident replay and operational predictability.",
      howTested: "Query graph endpoint and verify stage chain.",
      evidence: {
        graphExecutionId: graphCheck.payload.graphExecution?.graphExecutionId,
        stages: graphStages
      }
    });

    const auditCheck = await call(baseUrls.gateway, "/v1/audit/events", "GET", {
      headers: { authorization: `Bearer ${clinicianToken}` }
    });
    const auditClaim = makeClaim({
      claimId: "audit_evidence_chain",
      title: "Every major action is evidence-linked in audit trail",
      passed:
        auditCheck.status === 200 &&
        Array.isArray(auditCheck.payload.events) &&
        auditCheck.payload.events.length > 0 &&
        auditCheck.payload.events.every((event) => typeof event.evidenceId === "string"),
      whyItMatters: "Enables compliance review and forensic response.",
      howTested: "List audit events and verify evidence IDs are present.",
      evidence: {
        eventCount: auditCheck.payload.events?.length ?? 0,
        latestEvidenceId: auditCheck.payload.events?.[0]?.evidenceId
      }
    });

    const registryCheck = await call(baseUrls.toolRegistry, "/v1/tools?status=published");
    const registryManifests = registryCheck.payload.manifests ?? [];
    const registryClaim = makeClaim({
      claimId: "signed_connector_registry",
      title: "Signed connector registry exposes enterprise connectors including Linear",
      passed:
        registryCheck.status === 200 &&
        registryManifests.some((manifest) => manifest.toolId === "connector-linear-project") &&
        registryManifests.some((manifest) => manifest.toolId === "connector-fhir-read"),
      whyItMatters: "Validates enterprise integration depth and controlled connector onboarding.",
      howTested: "Query published manifests and assert required reference connectors exist.",
      evidence: {
        publishedCount: registryManifests.length,
        sampleToolIds: registryManifests.slice(0, 6).map((manifest) => manifest.toolId)
      }
    });

    const guardedToolCall = await call(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: {
        "x-actor-id": "user-workflow",
        "x-tenant-id": "tenant-starlight-health",
        "x-roles": "workflow_operator",
        "idempotency-key": "proof-email-guard-001"
      },
      body: {
        toolId: "connector-email-notify",
        action: "EXECUTE",
        mode: "execute",
        requestedNetworkProfile: "outbound-approved",
        stepBudgetRemaining: 2,
        requiresApproval: true,
        approvalGranted: false
      }
    });

    const toolGuardClaim = makeClaim({
      claimId: "tool_runtime_guard",
      title: "Tool runtime guard blocks unauthorized execution paths",
      passed: guardedToolCall.status === 403 && guardedToolCall.payload.guardReason === "approval_missing",
      whyItMatters: "Prevents direct tool bypass even when model output attempts unsafe actions.",
      howTested: "Invoke tool execution without required approval and assert blocked response.",
      evidence: {
        status: guardedToolCall.status,
        guardReason: guardedToolCall.payload.guardReason
      }
    });

    const idemHeaders = {
      "x-actor-id": "user-security",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "security_admin",
      "idempotency-key": "proof-linear-001"
    };
    const idemBody = {
      toolId: "connector-linear-project",
      action: "EXECUTE",
      mode: "simulate",
      requestedNetworkProfile: "project-ops",
      stepBudgetRemaining: 2,
      parameters: { project: "OpenAegis Commercial Ship", title: "commercial-proof-check" }
    };

    const firstLinearCall = await call(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: idemHeaders,
      body: idemBody
    });
    const replayLinearCall = await call(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: idemHeaders,
      body: idemBody
    });

    const idempotencyClaim = makeClaim({
      claimId: "idempotency_protection",
      title: "Tool execution supports idempotent retries",
      passed:
        firstLinearCall.status === 200 &&
        replayLinearCall.status === 200 &&
        replayLinearCall.payload.idempotentReplay === true &&
        firstLinearCall.payload.toolCallId === replayLinearCall.payload.toolCallId,
      whyItMatters: "Improves reliability for enterprise automation retries and outage recovery.",
      howTested: "Submit duplicate tool call with same idempotency key and assert replay semantics.",
      evidence: {
        firstCallId: firstLinearCall.payload.toolCallId,
        replayCallId: replayLinearCall.payload.toolCallId,
        replayed: replayLinearCall.payload.idempotentReplay === true
      }
    });

    report.claims = [
      policyGateClaim,
      approvalClaim,
      graphClaim,
      auditClaim,
      registryClaim,
      toolGuardClaim,
      idempotencyClaim
    ];

    report.summary.totalClaims = report.claims.length;
    report.summary.passedClaims = report.claims.filter((claim) => claim.passed).length;
    report.summary.failedClaims = report.summary.totalClaims - report.summary.passedClaims;
    report.summary.score = Math.round((report.summary.passedClaims / report.summary.totalClaims) * 100);
    report.summary.scorePercent = report.summary.score;
    report.summary.status = report.summary.failedClaims === 0 ? "PASS" : "FAIL";
    report.checks = report.claims;
  } finally {
    servers.gateway.close();
    servers.toolRegistry.close();
    servers.toolExecution.close();
    await Promise.all([
      once(servers.gateway, "close"),
      once(servers.toolRegistry, "close"),
      once(servers.toolExecution, "close")
    ]);
  }

  await mkdir("docs/assets/demo", { recursive: true });
  await writeFile("docs/assets/demo/commercial-proof-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommercialProof()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

