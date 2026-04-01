import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAppServer } from "./index.js";

let baseUrl = "http://127.0.0.1:3900";
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/pilot-state.json", { force: true });
  await rm(".volumes/api-gateway-security-state.json", { force: true });
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "true";
  server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
  delete process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH;
});

const loginAs = async (email: string): Promise<{ accessToken: string }> => {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { accessToken: string };
};

const createIncidentTrigger = async (accessToken: string) => {
  const response = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      mode: "simulation",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true,
      zeroRetentionRequested: false
    })
  });

  assert.equal(response.status, 201);
  const execution = (await response.json()) as { status: string; incidentId?: string; executionId: string };
  assert.equal(execution.status, "failed");
  assert.ok(execution.incidentId);
  return execution;
};

test("pilot workflow requires approval in live mode and completes after approval", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  assert.equal(login.status, 200);
  const authBody = (await login.json()) as { accessToken: string; user: { userId: string } };

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      mode: "live",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });

  assert.equal(execute.status, 201);
  const execution = (await execute.json()) as { executionId: string; status: string; approvalId?: string };
  assert.equal(execution.status, "blocked");
  assert.ok(execution.approvalId);

  const approverLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const approver = (await approverLogin.json()) as { accessToken: string };

  const decision = await fetch(`${baseUrl}/v1/approvals/${execution.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${approver.accessToken}`
    },
    body: JSON.stringify({ decision: "approve", reason: "Validated discharge criteria" })
  });

  assert.equal(decision.status, 200);

  const executionAfter = await fetch(`${baseUrl}/v1/executions/${execution.executionId}`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  const finalExecution = (await executionAfter.json()) as { status: string; toolCalls: string[] };
  assert.equal(finalExecution.status, "completed");
  assert.ok(finalExecution.toolCalls.length >= 3);

  const graph = await fetch(`${baseUrl}/v1/executions/${execution.executionId}/graph`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(graph.status, 200);
  const graphBody = (await graph.json()) as {
    graphExecution: { status: string; steps: Array<{ stage: string; status: string }> };
  };
  assert.equal(graphBody.graphExecution.status, "completed");
  assert.deepEqual(
    graphBody.graphExecution.steps.map((step) => step.stage),
    ["planner", "executor", "reviewer"]
  );
  assert.equal(graphBody.graphExecution.steps[2]?.status, "completed");

  const audit = await fetch(`${baseUrl}/v1/audit/events`, {
    headers: { authorization: `Bearer ${approver.accessToken}` }
  });
  assert.equal(audit.status, 200);
  const auditBody = (await audit.json()) as { events: Array<{ category: string }> };
  assert.ok(auditBody.events.some((event) => event.category === "workflow"));
  assert.ok(auditBody.events.some((event) => event.category === "approval"));
});

test("approval decision is limited to privileged roles", async () => {
  const clinicianLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  assert.equal(clinicianLogin.status, 200);
  const clinician = (await clinicianLogin.json()) as { accessToken: string };

  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  assert.equal(securityLogin.status, 200);
  const security = (await securityLogin.json()) as { accessToken: string };

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({
      mode: "live",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });
  assert.equal(execute.status, 201);
  const execution = (await execute.json()) as { approvalId?: string };
  assert.ok(execution.approvalId);

  const clinicianDecision = await fetch(`${baseUrl}/v1/approvals/${execution.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({ decision: "approve", reason: "self-approval attempt" })
  });
  assert.equal(clinicianDecision.status, 403);
  const clinicianBody = (await clinicianDecision.json()) as { error: string };
  assert.equal(clinicianBody.error, "insufficient_role_for_approval_decision");

  const securityDecision = await fetch(`${baseUrl}/v1/approvals/${execution.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({ decision: "approve", reason: "authorized approval" })
  });
  assert.equal(securityDecision.status, 200);
});

test("approval cannot be decided more than once", async () => {
  const clinicianLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const clinician = (await clinicianLogin.json()) as { accessToken: string };

  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const security = (await securityLogin.json()) as { accessToken: string };

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({
      mode: "live",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });
  assert.equal(execute.status, 201);
  const execution = (await execute.json()) as { approvalId?: string };
  assert.ok(execution.approvalId);

  const firstDecision = await fetch(`${baseUrl}/v1/approvals/${execution.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({ decision: "approve", reason: "first decision" })
  });
  assert.equal(firstDecision.status, 200);

  const secondDecision = await fetch(`${baseUrl}/v1/approvals/${execution.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({ decision: "reject", reason: "second decision should fail" })
  });
  assert.equal(secondDecision.status, 409);
  const secondBody = (await secondDecision.json()) as { error: string };
  assert.equal(secondBody.error, "approval_already_decided");
});

test("approved tool execution approvals are single-use", async () => {
  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const security = (await securityLogin.json()) as { accessToken: string };

  const createApproval = await fetch(`${baseUrl}/v1/approvals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({
      tenantId: "tenant-starlight-health",
      reason: "Authorize one outbound notification"
    })
  });
  assert.equal(createApproval.status, 201);
  const approval = (await createApproval.json()) as { approvalId: string };

  const approve = await fetch(`${baseUrl}/v1/approvals/${approval.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({ decision: "approve", reason: "approved for single use" })
  });
  assert.equal(approve.status, 200);

  const firstExecute = await fetch(`${baseUrl}/v1/tools/connector-email-notify/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`,
      "idempotency-key": "gateway-tool-execute-001"
    },
    body: JSON.stringify({
      tenantId: "tenant-starlight-health",
      approvalId: approval.approvalId,
      recipient: "patient@example.org"
    })
  });
  assert.equal(firstExecute.status, 200);

  const secondExecute = await fetch(`${baseUrl}/v1/tools/connector-email-notify/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`,
      "idempotency-key": "gateway-tool-execute-001"
    },
    body: JSON.stringify({
      tenantId: "tenant-starlight-health",
      approvalId: approval.approvalId,
      recipient: "patient@example.org"
    })
  });
  assert.equal(secondExecute.status, 409);
  const body = (await secondExecute.json()) as { error: string };
  assert.equal(body.error, "approval_already_used");
});

test("simulation mode completes without approval", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      mode: "simulation",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });

  const execution = (await execute.json()) as { status: string; approvalId?: string };
  assert.equal(execution.status, "completed");
  assert.equal(execution.approvalId, undefined);
});

test("reviewer rejection creates an incident and records graph steps", async () => {
  const clinician = await loginAs("clinician@starlighthealth.org");
  const security = await loginAs("security@starlighthealth.org");

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({
      mode: "simulation",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-2002",
      requestFollowupEmail: true
    })
  });

  assert.equal(execute.status, 201);
  const execution = (await execute.json()) as { status: string; incidentId?: string; executionId: string };
  assert.equal(execution.status, "failed");
  assert.ok(execution.incidentId);

  const graph = await fetch(`${baseUrl}/v1/executions/${execution.executionId}/graph`, {
    headers: { authorization: `Bearer ${clinician.accessToken}` }
  });
  const graphBody = (await graph.json()) as {
    graphExecution: { status: string; currentStage: string; steps: Array<{ stage: string; status: string }> };
  };
  assert.equal(graphBody.graphExecution.status, "failed");
  assert.equal(graphBody.graphExecution.currentStage, "review_rejected");
  assert.deepEqual(
    graphBody.graphExecution.steps.map((step) => step.stage),
    ["planner", "executor", "reviewer"]
  );
  assert.equal(graphBody.graphExecution.steps[2]?.status, "failed");

  const incident = await fetch(`${baseUrl}/v1/incidents/${execution.incidentId}`, {
    headers: { authorization: `Bearer ${security.accessToken}` }
  });
  assert.equal(incident.status, 200);
  const incidentBody = (await incident.json()) as { category: string; executionId: string };
  assert.equal(incidentBody.category, "review_rejection");
  assert.equal(incidentBody.executionId, execution.executionId);
});

test("incident endpoints require privileged roles even within the same tenant", async () => {
  const clinician = await loginAs("clinician@starlighthealth.org");
  const security = await loginAs("security@starlighthealth.org");

  const execution = await createIncidentTrigger(clinician.accessToken);

  const clinicianList = await fetch(`${baseUrl}/v1/incidents`, {
    headers: { authorization: `Bearer ${clinician.accessToken}` }
  });
  assert.equal(clinicianList.status, 403);
  const clinicianListBody = (await clinicianList.json()) as { error: string };
  assert.equal(clinicianListBody.error, "insufficient_role_for_incident_list");

  const securityList = await fetch(`${baseUrl}/v1/incidents`, {
    headers: { authorization: `Bearer ${security.accessToken}` }
  });
  assert.equal(securityList.status, 200);
  const securityListBody = (await securityList.json()) as { incidents: Array<{ incidentId: string; category: string }> };
  assert.ok(securityListBody.incidents.some((item) => item.incidentId === execution.incidentId && item.category === "policy_violation"));

  const clinicianDetail = await fetch(`${baseUrl}/v1/incidents/${execution.incidentId}`, {
    headers: { authorization: `Bearer ${clinician.accessToken}` }
  });
  assert.equal(clinicianDetail.status, 403);
  const clinicianDetailBody = (await clinicianDetail.json()) as { error: string };
  assert.equal(clinicianDetailBody.error, "insufficient_role_for_incident_read");

  const securityDetail = await fetch(`${baseUrl}/v1/incidents/${execution.incidentId}`, {
    headers: { authorization: `Bearer ${security.accessToken}` }
  });
  assert.equal(securityDetail.status, 200);
  const securityDetailBody = (await securityDetail.json()) as { incidentId: string; category: string };
  assert.equal(securityDetailBody.incidentId, execution.incidentId);
  assert.equal(securityDetailBody.category, "policy_violation");
});

test("agent graph incident views require privileged roles", async () => {
  const clinician = await loginAs("clinician@starlighthealth.org");
  const security = await loginAs("security@starlighthealth.org");
  const execution = await createIncidentTrigger(clinician.accessToken);

  const graphListResponse = await fetch(`${baseUrl}/v1/agent-graphs`, {
    headers: { authorization: `Bearer ${clinician.accessToken}` }
  });
  assert.equal(graphListResponse.status, 403);
  const graphListBody = (await graphListResponse.json()) as { error: string };
  assert.equal(graphListBody.error, "insufficient_role_for_agent_graph_read");

  const graphResponse = await fetch(`${baseUrl}/v1/agent-graphs/discharge-assistant`, {
    headers: { authorization: `Bearer ${clinician.accessToken}` }
  });
  assert.equal(graphResponse.status, 403);
  const graphBody = (await graphResponse.json()) as { error: string };
  assert.equal(graphBody.error, "insufficient_role_for_agent_graph_read");

  const graphExecutionResponse = await fetch(
    `${baseUrl}/v1/agent-graphs/discharge-assistant/executions/${execution.executionId}`,
    {
      headers: { authorization: `Bearer ${clinician.accessToken}` }
    }
  );
  assert.equal(graphExecutionResponse.status, 403);
  const graphExecutionBody = (await graphExecutionResponse.json()) as { error: string };
  assert.equal(graphExecutionBody.error, "insufficient_role_for_agent_graph_read");

  const securityGraphResponse = await fetch(`${baseUrl}/v1/agent-graphs/discharge-assistant`, {
    headers: { authorization: `Bearer ${security.accessToken}` }
  });
  assert.equal(securityGraphResponse.status, 200);
  const securityGraphBody = (await securityGraphResponse.json()) as {
    graph: { graphId: string };
    executions: Array<{ executionId: string }>;
    incidents: Array<{ incidentId: string }>;
  };
  assert.equal(securityGraphBody.graph.graphId, "discharge-assistant");
  assert.ok(securityGraphBody.executions.some((item) => item.executionId === execution.executionId));
  assert.ok(securityGraphBody.incidents.some((item) => item.incidentId === execution.incidentId));

  const securityGraphExecutionResponse = await fetch(
    `${baseUrl}/v1/agent-graphs/discharge-assistant/executions/${execution.executionId}`,
    {
      headers: { authorization: `Bearer ${security.accessToken}` }
    }
  );
  assert.equal(securityGraphExecutionResponse.status, 200);
  const securityGraphExecutionBody = (await securityGraphExecutionResponse.json()) as {
    graphExecution: { executionId: string };
    execution: { executionId: string };
  };
  assert.equal(securityGraphExecutionBody.execution.executionId, execution.executionId);
});

test("commercial proof endpoint returns live claim snapshot", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  assert.equal(login.status, 200);
  const authBody = (await login.json()) as { accessToken: string };

  const proof = await fetch(`${baseUrl}/v1/commercial/proof`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(proof.status, 200);
  const body = (await proof.json()) as {
    live: { executions: number };
    claims: Array<{ id: string; status: string }>;
  };
  assert.ok(typeof body.live.executions === "number");
  assert.ok(body.claims.length >= 4);
  assert.ok(body.claims.some((claim) => claim.id === "audit-evidence-coverage"));
});

test("commercial readiness endpoint returns claim scorecard", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const readiness = await fetch(`${baseUrl}/v1/commercial/readiness`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(readiness.status, 200);
  const body = (await readiness.json()) as {
    generatedAt: string;
    summary: { score: number; totalClaims: number; passedClaims: number };
    claims: Array<{ claimId: string; status: string }>;
  };
  assert.ok(typeof body.generatedAt === "string");
  assert.equal(body.summary.totalClaims, 4);
  assert.ok(body.summary.score >= 0 && body.summary.score <= 100);
  assert.equal(body.claims.length, 4);
  assert.ok(body.claims.some((claim) => claim.claimId === "immutable_audit_chain"));
});

test("commercial claims endpoint returns verification summary", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      mode: "simulation",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });

  const claimsResponse = await fetch(`${baseUrl}/v1/commercial/claims`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(claimsResponse.status, 200);
  const claims = (await claimsResponse.json()) as {
    executionTotals: { total: number };
    claims: Array<{ claimId: string; status: string }>;
  };
  assert.ok(claims.executionTotals.total >= 1);
  assert.ok(claims.claims.some((claim) => claim.claimId === "policy_gates_enforced"));
});

test("project pack catalog lists five commercial packs", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const response = await fetch(`${baseUrl}/v1/projects/packs`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { packs: Array<{ packId: string }> };
  assert.equal(body.packs.length, 5);
  assert.deepEqual(
    body.packs.map((pack) => pack.packId),
    [
      "secops-runtime-guard",
      "revenue-cycle-copilot",
      "supply-chain-resilience",
      "clinical-quality-signal",
      "board-risk-cockpit"
    ]
  );
});

test("project pack run endpoint launches workflow execution with pack defaults", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const run = await fetch(`${baseUrl}/v1/projects/packs/revenue-cycle-copilot/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      mode: "simulation",
      requestFollowupEmail: true
    })
  });
  assert.equal(run.status, 201);
  const body = (await run.json()) as {
    pack: { packId: string; workflowId: string };
    execution: { executionId: string; workflowId: string; mode: string; status: string };
  };
  assert.equal(body.pack.packId, "revenue-cycle-copilot");
  assert.equal(body.execution.workflowId, body.pack.workflowId);
  assert.equal(body.execution.mode, "simulation");
  assert.ok(typeof body.execution.executionId === "string" && body.execution.executionId.length > 0);
  assert.ok(["completed", "failed", "blocked"].includes(body.execution.status));
});

test("project pack experience endpoint returns seeded data and evaluated policy scenarios", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const response = await fetch(`${baseUrl}/v1/projects/packs/secops-runtime-guard/experience`, {
    headers: { authorization: `Bearer ${authBody.accessToken}` }
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    pack: { packId: string };
    experience: {
      dataTables: Array<{ tableId: string; rows: Array<Record<string, unknown>> }>;
      policyScenarios: Array<{
        scenarioId: string;
        decision: { effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY"; reasons: string[] };
      }>;
      walkthrough: Array<{ step: number; title: string }>;
    };
    policyProfile: { profileVersion: number };
  };
  assert.equal(body.pack.packId, "secops-runtime-guard");
  assert.ok(body.experience.dataTables.length >= 1);
  assert.ok(body.experience.dataTables[0]!.rows.length >= 1);
  assert.ok(body.experience.policyScenarios.length >= 2);
  assert.ok(body.experience.policyScenarios.every((scenario) => typeof scenario.decision.effect === "string"));
  assert.ok(body.experience.walkthrough.length >= 4);
  assert.ok(body.policyProfile.profileVersion >= 1);
});

test("project pack policy preset apply is role-gated and updates policy profile", async () => {
  const clinicianLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const clinician = (await clinicianLogin.json()) as { accessToken: string };

  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const security = (await securityLogin.json()) as { accessToken: string };

  const denied = await fetch(`${baseUrl}/v1/projects/packs/revenue-cycle-copilot/policies/apply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    }
  });
  assert.equal(denied.status, 403);

  const applied = await fetch(`${baseUrl}/v1/projects/packs/revenue-cycle-copilot/policies/apply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    }
  });
  assert.equal(applied.status, 200);
  const body = (await applied.json()) as {
    pack: { packId: string };
    appliedPreset: { profileName: string };
    result: { profile: { profileVersion: number; profileName: string } };
  };
  assert.equal(body.pack.packId, "revenue-cycle-copilot");
  assert.equal(body.result.profile.profileName, body.appliedPreset.profileName);
  assert.ok(body.result.profile.profileVersion >= 1);
});

test("project pack experience endpoint exposes deep operational context for all five packs", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const packIds = [
    "secops-runtime-guard",
    "revenue-cycle-copilot",
    "supply-chain-resilience",
    "clinical-quality-signal",
    "board-risk-cockpit"
  ] as const;

  for (const packId of packIds) {
    const response = await fetch(`${baseUrl}/v1/projects/packs/${packId}/experience`, {
      headers: { authorization: `Bearer ${authBody.accessToken}` }
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      pack: { packId: string; name: string; persona: string };
      experience: {
        plainLanguageSummary: string;
        dataTables: Array<{
          tableId: string;
          classification: string;
          columns: Array<{ key: string; label: string }>;
          rows: Array<Record<string, unknown>>;
        }>;
        policyRules: Array<{ ruleId: string; effect: string; severity: string }>;
        policyScenarios: Array<{
          scenarioId: string;
          input: { mode: string; riskLevel: string };
          decision: { effect: string; reasons: string[]; obligations: string[] };
        }>;
        walkthrough: Array<{
          step: number;
          title: string;
          operatorAction: string;
          openAegisControl: string;
          evidenceProduced: string;
        }>;
        trustChecks: string[];
      };
      policyProfile: { profileName: string; profileVersion: number };
    };

    assert.equal(body.pack.packId, packId);
    assert.ok(body.pack.name.length > 0);
    assert.ok(body.pack.persona.length > 0);
    assert.ok(body.experience.plainLanguageSummary.length > 20);
    assert.ok(body.experience.dataTables.length >= 1);
    assert.ok(body.experience.dataTables.every((table) => table.columns.length >= 3));
    assert.ok(body.experience.dataTables.every((table) => table.rows.length >= 1));
    assert.ok(body.experience.policyRules.length >= 2);
    assert.ok(body.experience.policyScenarios.length >= 2);
    assert.ok(body.experience.policyScenarios.every((scenario) => Array.isArray(scenario.decision.reasons)));
    assert.ok(body.experience.policyScenarios.every((scenario) => Array.isArray(scenario.decision.obligations)));
    assert.ok(body.experience.walkthrough.length >= 4);
    assert.ok(body.experience.walkthrough.every((step) => step.evidenceProduced.length > 0));
    assert.ok(body.experience.trustChecks.length >= 2);
    assert.ok(body.policyProfile.profileName.length > 0);
    assert.ok(body.policyProfile.profileVersion >= 1);
  }
});

test("policy profile endpoints preview and save controls with role checks", async () => {
  const clinicianLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const clinician = (await clinicianLogin.json()) as { accessToken: string };

  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const security = (await securityLogin.json()) as { accessToken: string };

  const preview = await fetch(`${baseUrl}/v1/policies/profile/preview`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({
      profileName: "Less strict approvals",
      controls: {
        requireApprovalForHighRiskLive: false
      }
    })
  });
  assert.equal(preview.status, 200);
  const previewBody = (await preview.json()) as {
    validation: { valid: boolean; issues: Array<{ code: string; severity: string }> };
  };
  assert.equal(previewBody.validation.valid, true);
  assert.ok(previewBody.validation.issues.some((issue) => issue.code === "high_risk_approval_disabled"));

  const deniedSave = await fetch(`${baseUrl}/v1/policies/profile/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({
      changeSummary: "Trying to save without security role",
      controls: { requireApprovalForHighRiskLive: false }
    })
  });
  assert.equal(deniedSave.status, 403);

  const saved = await fetch(`${baseUrl}/v1/policies/profile/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({
      changeSummary: "Temporary reduction for pilot demonstration",
      controls: { requireApprovalForHighRiskLive: false }
    })
  });
  assert.equal(saved.status, 200);

  const execute = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${clinician.accessToken}`
    },
    body: JSON.stringify({
      mode: "live",
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      requestFollowupEmail: true
    })
  });
  assert.equal(execute.status, 201);
  const execution = (await execute.json()) as { status: string; approvalId?: string };
  assert.equal(execution.status, "completed");
  assert.equal(execution.approvalId, undefined);
});

test("blocking policy changes require break-glass fields", async () => {
  const securityLogin = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const security = (await securityLogin.json()) as { accessToken: string };

  const denied = await fetch(`${baseUrl}/v1/policies/profile/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({
      changeSummary: "Unsafe change without break-glass",
      controls: { enforceSecretDeny: false }
    })
  });
  assert.equal(denied.status, 422);
  const deniedBody = (await denied.json()) as { error: string };
  assert.equal(deniedBody.error, "break_glass_required_for_blocking_policy_changes");

  const approved = await fetch(`${baseUrl}/v1/policies/profile/save`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${security.accessToken}`
    },
    body: JSON.stringify({
      changeSummary: "Emergency break-glass test",
      controls: { enforceSecretDeny: false },
      breakGlass: {
        ticketId: "BG-2026-001",
        justification: "Emergency scenario validation under supervision.",
        approverIds: ["security-lead-1", "compliance-lead-2"]
      }
    })
  });
  assert.equal(approved.status, 200);
  const approvedBody = (await approved.json()) as { breakGlassUsed: boolean };
  assert.equal(approvedBody.breakGlassUsed, true);
});

test("policy copilot endpoint returns actionable guidance", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const response = await fetch(`${baseUrl}/v1/policies/profile/copilot`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      operatorGoal: "Keep this safe for patient data and easy for new staff.",
      controls: {
        requireApprovalForHighRiskLive: false,
        maxToolCallsPerExecution: 18
      }
    })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    source: string;
    hints: string[];
    suggestedControls: { requireApprovalForHighRiskLive: boolean };
  };
  assert.ok(body.source === "builtin" || body.source === "local-llm");
  assert.ok(body.hints.length >= 2);
  assert.equal(body.suggestedControls.requireApprovalForHighRiskLive, true);
});

test("policy explain endpoint returns plain-language impact and safe advisor output", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };

  const response = await fetch(`${baseUrl}/v1/policies/profile/explain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({
      operatorGoal: "Make this easy for new staff but keep strict safety controls.",
      controls: {
        requireApprovalForHighRiskLive: false,
        maxToolCallsPerExecution: 16
      }
    })
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    explainability: {
      posture: "improved" | "degraded" | "unchanged";
      riskDelta: number;
      controls: Array<{ control: string; changed: boolean }>;
      nextSteps: string[];
    };
    advisor: {
      source: "local-llm" | "builtin";
      confidence: number;
      hints: string[];
      suggestedControls: { requireApprovalForHighRiskLive: boolean };
    };
  };
  assert.equal(body.explainability.posture, "degraded");
  assert.ok(body.explainability.riskDelta > 0);
  assert.ok(body.explainability.controls.some((item) => item.control === "requireApprovalForHighRiskLive" && item.changed));
  assert.ok(body.explainability.nextSteps.length >= 3);
  assert.ok(body.advisor.source === "builtin" || body.advisor.source === "local-llm");
  assert.ok(body.advisor.hints.length >= 2);
  assert.ok(body.advisor.confidence > 0);
  assert.equal(body.advisor.suggestedControls.requireApprovalForHighRiskLive, true);
});

test("gateway supports auth-service token introspection and enforces tenant scope", async () => {
  const introspectionServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/v1/auth/introspect") {
      response.writeHead(404).end();
      return;
    }

    if (process.env.OPENAEGIS_REQUIRE_SIGNED_INTERNAL_CONTEXT === "true") {
      assert.equal(typeof request.headers["x-openaegis-internal-context"], "string");
      assert.equal(typeof request.headers["x-openaegis-internal-context-signature"], "string");
      const payload = JSON.parse(
        Buffer.from(String(request.headers["x-openaegis-internal-context"]), "base64url").toString("utf8")
      ) as { actorId: string; tenantId: string; roles: string[]; issuedAt: number; v: number };
      assert.equal(payload.v, 1);
      assert.equal(payload.actorId, "service-gateway");
      assert.equal(payload.tenantId, "tenant-platform");
      assert.deepEqual(payload.roles, ["service_account", "token_introspect"]);
      assert.equal(typeof payload.issuedAt, "number");
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { token?: string };

    if (payload.token === "oidc-security-good") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          active: true,
          sub: "user-security",
          tenantId: "tenant-starlight-health",
          roles: ["security_admin", "platform_admin"],
          assuranceLevel: "aal3"
        })
      );
      return;
    }

    if (payload.token === "oidc-clinician-good") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          active: true,
          sub: "user-clinician",
          tenantId: "tenant-starlight-health",
          roles: ["workflow_operator", "analyst"],
          assuranceLevel: "aal2"
        })
      );
      return;
    }

    if (payload.token === "oidc-approver-same-tenant") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          active: true,
          sub: "user-security",
          tenantId: "tenant-starlight-health",
          roles: ["approver"],
          assuranceLevel: "aal3"
        })
      );
      return;
    }

    if (payload.token === "oidc-approver-cross-tenant") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          active: true,
          sub: "user-security",
          tenantId: "tenant-other",
          roles: ["approver"],
          assuranceLevel: "aal3"
        })
      );
      return;
    }

    if (payload.token === "oidc-cross-tenant") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          active: true,
          sub: "user-security",
          tenantId: "tenant-other",
          roles: ["security_admin"],
          assuranceLevel: "aal3"
        })
      );
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ active: false }));
  });

  introspectionServer.listen(3912);
  await once(introspectionServer, "listening");

  process.env.OPENAEGIS_AUTH_INTROSPECTION_URL = "http://127.0.0.1:3912/v1/auth/introspect";
  process.env.OPENAEGIS_REQUIRE_INTROSPECTION = "true";
  process.env.OPENAEGIS_REQUIRE_SIGNED_INTERNAL_CONTEXT = "true";
  process.env.OPENAEGIS_INTERNAL_CONTEXT_SIGNING_KEY = "gateway-internal-context-key";

  try {
    const authorized = await fetch(`${baseUrl}/v1/policies/profile`, {
      headers: { authorization: "Bearer oidc-security-good" }
    });
    assert.equal(authorized.status, 200);

    const clinicianPolicyReadDenied = await fetch(`${baseUrl}/v1/policies/profile`, {
      headers: { authorization: "Bearer oidc-clinician-good" }
    });
    assert.equal(clinicianPolicyReadDenied.status, 403);
    const clinicianPolicyReadDeniedBody = (await clinicianPolicyReadDenied.json()) as { error: string };
    assert.equal(clinicianPolicyReadDeniedBody.error, "insufficient_role_for_policy_profile_read");

    const crossTenantPolicyReadDenied = await fetch(`${baseUrl}/v1/policies/profile`, {
      headers: { authorization: "Bearer oidc-cross-tenant" }
    });
    assert.equal(crossTenantPolicyReadDenied.status, 403);
    const crossTenantPolicyReadDeniedBody = (await crossTenantPolicyReadDenied.json()) as { error: string };
    assert.equal(crossTenantPolicyReadDeniedBody.error, "tenant_scope_mismatch");

    const crossTenantDenied = await fetch(`${baseUrl}/v1/executions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer oidc-cross-tenant"
      },
      body: JSON.stringify({
        mode: "simulation",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        tenantId: "tenant-starlight-health"
      })
    });
    assert.equal(crossTenantDenied.status, 403);
    const crossBody = (await crossTenantDenied.json()) as { error: string };
    assert.equal(crossBody.error, "tenant_scope_mismatch");

    const approvalExecution = await fetch(`${baseUrl}/v1/executions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer oidc-clinician-good"
      },
      body: JSON.stringify({
        mode: "live",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        tenantId: "tenant-starlight-health"
      })
    });
    assert.equal(approvalExecution.status, 201);
    const approvalExecutionBody = (await approvalExecution.json()) as { approvalId?: string; status: string; executionId: string };
    assert.equal(approvalExecutionBody.status, "blocked");
    assert.ok(approvalExecutionBody.approvalId);

    const crossTenantDecision = await fetch(`${baseUrl}/v1/approvals/${approvalExecutionBody.approvalId}/decide`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer oidc-approver-cross-tenant"
      },
      body: JSON.stringify({ decision: "approve", reason: "cross-tenant attempt" })
    });
    assert.equal(crossTenantDecision.status, 403);
    const crossTenantDecisionBody = (await crossTenantDecision.json()) as { error: string };
    assert.equal(crossTenantDecisionBody.error, "tenant_scope_mismatch");

    const sameTenantDecision = await fetch(`${baseUrl}/v1/approvals/${approvalExecutionBody.approvalId}/decide`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer oidc-approver-same-tenant"
      },
      body: JSON.stringify({ decision: "approve", reason: "authorized approver" })
    });
    assert.equal(sameTenantDecision.status, 200);

    const crossTenantExecutionRead = await fetch(
      `${baseUrl}/v1/executions/${approvalExecutionBody.executionId}`,
      {
        headers: { authorization: "Bearer oidc-cross-tenant" }
      }
    );
    assert.equal(crossTenantExecutionRead.status, 403);
    const crossTenantExecutionReadBody = (await crossTenantExecutionRead.json()) as { error: string };
    assert.equal(crossTenantExecutionReadBody.error, "tenant_scope_mismatch");

    const clinicianCommercialReadDenied = await fetch(`${baseUrl}/v1/commercial/readiness`, {
      headers: { authorization: "Bearer oidc-clinician-good" }
    });
    assert.equal(clinicianCommercialReadDenied.status, 403);
    const clinicianCommercialReadDeniedBody = (await clinicianCommercialReadDenied.json()) as { error: string };
    assert.equal(clinicianCommercialReadDeniedBody.error, "insufficient_role_for_commercial_readiness");

    const inactive = await fetch(`${baseUrl}/v1/policies/profile`, {
      headers: { authorization: "Bearer unknown-token" }
    });
    assert.equal(inactive.status, 401);
  } finally {
    delete process.env.OPENAEGIS_AUTH_INTROSPECTION_URL;
    delete process.env.OPENAEGIS_REQUIRE_INTROSPECTION;
    delete process.env.OPENAEGIS_REQUIRE_SIGNED_INTERNAL_CONTEXT;
    delete process.env.OPENAEGIS_INTERNAL_CONTEXT_SIGNING_KEY;
    introspectionServer.close();
    await once(introspectionServer, "close");
  }
});

test("rejects oversized payloads", async () => {
  const login = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  const authBody = (await login.json()) as { accessToken: string };
  const oversized = "x".repeat(1024 * 1024 + 1024);

  const response = await fetch(`${baseUrl}/v1/policy/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authBody.accessToken}`
    },
    body: JSON.stringify({ action: oversized })
  });

  assert.equal(response.status, 413);
});

test("demo login endpoint is disabled when insecure demo auth flag is not enabled", async () => {
  delete process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH;
  const disabledServer = createAppServer();
  disabledServer.listen(3902);
  await once(disabledServer, "listening");

  try {
    const response = await fetch("http://127.0.0.1:3902/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "clinician@starlighthealth.org" })
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "demo_auth_disabled");
  } finally {
    disabledServer.close();
    await once(disabledServer, "close");
    process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "true";
  }
});
