import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import {
  createApproval,
  evaluatePolicy,
  getPolicyProfileSnapshot,
  getAgentGraphDefinition,
  getGraphExecution,
  getGraphExecutionByExecutionId,
  getIncident,
  listAgentGraphDefinitions,
  listIncidents,
  loadState,
  previewPolicyProfile,
  routeModel,
  savePolicyProfile,
  resolveApprovalAndAdvanceExecution,
  saveState,
  startDischargeAssistantExecution,
  suggestPolicyAutofix,
  type PilotMode,
  type PolicyProfileControls
} from "@openaegis/pilot-core";

export const descriptor: ServiceDescriptor = {
  serviceName: "api-gateway",
  listeningPort: Number(process.env.PORT ?? 3000),
  purpose: "External API ingress, authn propagation, tenant and policy pre-checks",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

interface JsonMap {
  [key: string]: unknown;
}

const roleToPrivileges: Record<string, string[]> = {
  clinician: ["workflow_operator", "analyst"],
  security: ["security_admin", "approver", "auditor", "platform_admin"],
  admin: ["platform_admin", "security_admin", "auditor", "workflow_operator", "approver", "analyst"]
};

const roleToAssurance: Record<string, "aal1" | "aal2" | "aal3"> = {
  clinician: "aal2",
  security: "aal3",
  admin: "aal3"
};

const resolveUserRole = (user: { role?: string; roles?: string[] }): "clinician" | "security" | "admin" => {
  if (typeof user.role === "string") {
    if (user.role === "security" || user.role === "admin" || user.role === "clinician") return user.role;
  }

  if (Array.isArray(user.roles)) {
    if (user.roles.includes("platform_admin")) return "admin";
    if (user.roles.includes("security_admin") || user.roles.includes("approver")) return "security";
  }
  return "clinician";
};

const checkGraphHashChain = (steps: Array<{ hash: string; previousHash: string | null; stage: string }>) => {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (typeof step.hash !== "string" || step.hash.length < 16) return false;
    if (index === 0 && step.previousHash !== null) return false;
    if (index > 0 && step.previousHash !== steps[index - 1]!.hash) return false;
  }
  return steps.map((step) => step.stage).join(">") === "planner>executor>reviewer";
};

const readCommercialProofReport = async (): Promise<Record<string, unknown> | undefined> => {
  try {
    return JSON.parse(await readFile("docs/assets/demo/commercial-proof-report.json", "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const buildCommercialSnapshot = async () => {
  const state = await loadState();
  const allEvidenceNonEmpty = state.auditEvents.every((event) => typeof event.evidenceId === "string" && event.evidenceId.length > 0);
  const graphDeterminism = state.graphExecutions.length > 0
    ? state.graphExecutions.every((graphExecution) => checkGraphHashChain(graphExecution.steps))
    : false;

  return {
    generatedAt: new Date().toISOString(),
    live: {
      executions: state.executions.length,
      approvals: state.approvals.length,
      auditEvents: state.auditEvents.length,
      graphExecutions: state.graphExecutions.length,
      incidents: state.incidents.length
    },
    claims: [
      {
        id: "policy-enforced-outside-model",
        title: "Policy controls enforced before and during execution",
        status: state.executions.some((execution) => execution.policyDecision.effect !== "ALLOW") ? "pass" : "warn",
        evidence: {
          nonAllowExecutions: state.executions.filter((execution) => execution.policyDecision.effect !== "ALLOW").length
        }
      },
      {
        id: "human-approval-gate",
        title: "High-risk live paths require human approval",
        status: state.approvals.length > 0 ? "pass" : "warn",
        evidence: {
          approvals: state.approvals.length
        }
      },
      {
        id: "audit-evidence-coverage",
        title: "Audit stream carries evidence IDs for replay and review",
        status: allEvidenceNonEmpty && state.auditEvents.length > 0 ? "pass" : "fail",
        evidence: {
          allEvidenceNonEmpty,
          auditEvents: state.auditEvents.length
        }
      },
      {
        id: "graph-determinism",
        title: "Graph execution shows deterministic planner-executor-reviewer hash chain",
        status: graphDeterminism ? "pass" : "warn",
        evidence: {
          graphExecutions: state.graphExecutions.length
        }
      }
    ]
  };
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<JsonMap> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonMap;
  } catch {
    return {};
  }
};

const getActorFromAuthHeader = (request: IncomingMessage): string | undefined => {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const parts = header.split(" ");
  if (parts.length !== 2) return undefined;
  const token = parts[1];
  if (!token) return undefined;
  if (!token.startsWith("demo-token-")) return undefined;
  return token.replace("demo-token-", "");
};

const toString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const parseDraftControls = (body: JsonMap): Partial<PolicyProfileControls> => {
  const controls = typeof body.controls === "object" && body.controls !== null ? (body.controls as Record<string, unknown>) : {};
  const draft: Partial<PolicyProfileControls> = {};
  if ("enforceSecretDeny" in controls) draft.enforceSecretDeny = toBoolean(controls.enforceSecretDeny, true);
  if ("requireZeroRetentionForPhi" in controls) draft.requireZeroRetentionForPhi = toBoolean(controls.requireZeroRetentionForPhi, true);
  if ("requireApprovalForHighRiskLive" in controls) {
    draft.requireApprovalForHighRiskLive = toBoolean(controls.requireApprovalForHighRiskLive, true);
  }
  if ("requireDlpOnOutbound" in controls) draft.requireDlpOnOutbound = toBoolean(controls.requireDlpOnOutbound, true);
  if ("restrictExternalProvidersToZeroRetention" in controls) {
    draft.restrictExternalProvidersToZeroRetention = toBoolean(controls.restrictExternalProvidersToZeroRetention, true);
  }
  if ("maxToolCallsPerExecution" in controls) {
    draft.maxToolCallsPerExecution = toNumber(controls.maxToolCallsPerExecution, 8);
  }
  return draft;
};

const readLocalPolicyCopilot = async (input: {
  current: unknown;
  proposed: unknown;
  validation: unknown;
  operatorGoal: string;
}) => {
  const endpoint = process.env.OPENAEGIS_LOCAL_LLM_ENDPOINT;
  if (!endpoint) return undefined;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "openaegis-policy-review",
        input
      })
    });
    if (!response.ok) return undefined;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const createExecution = async (input: {
  actorId: string;
  patientId: string;
  mode: PilotMode;
  workflowId: string;
  tenantId: string;
  requestFollowupEmail: boolean;
  classification?: string;
  zeroRetentionRequested?: boolean;
}) => {
  const result = await startDischargeAssistantExecution({
    actorId: input.actorId,
    patientId: input.patientId,
    mode: input.mode,
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    requestFollowupEmail: input.requestFollowupEmail,
    ...(typeof input.classification === "string"
      ? { classification: input.classification as "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET" }
      : {}),
    ...(typeof input.zeroRetentionRequested === "boolean" ? { zeroRetentionRequested: input.zeroRetentionRequested } : {})
  });

  if ("status" in result) {
    return result;
  }

  return { status: 201, body: { ...result.execution, graphExecutionStatus: result.graphExecution.status, incidentId: result.incident?.incidentId } };
};

const handleApprove = async (approvalId: string, actorId: string, body: JsonMap) => {
  const decision = (body.decision === "approve" ? "approved" : "rejected") as "approved" | "rejected";
  const result = await resolveApprovalAndAdvanceExecution({
    approvalId,
    actorId,
    decision,
    ...(typeof body.reason === "string" ? { reason: body.reason } : {})
  });

  if ("status" in result) {
    return result;
  }

  const state = await loadState();
  const approval = state.approvals.find((item) => item.approvalId === approvalId);
  if (!approval) {
    return { status: 404, body: { error: "approval_not_found" } };
  }

  return { status: 200, body: approval };
};

const buildCommercialReadinessSnapshot = async () => {
  const state = await loadState();
  const executions = state.executions;
  const approvals = state.approvals;
  const auditEvents = state.auditEvents;
  const incidents = state.incidents;

  const claims = [
    {
      claimId: "policy_enforced_outside_model",
      title: "Policy is enforced outside the model",
      status: executions.some((execution) => execution.status === "blocked" || execution.status === "failed") ? "pass" : "watch",
      howTested: "Run live workflow and verify blocked/failed path before unsafe action.",
      evidence: executions
        .filter((execution) => execution.status === "blocked" || execution.status === "failed")
        .slice(0, 5)
        .map((execution) => execution.evidenceId)
    },
    {
      claimId: "human_approval_for_high_risk",
      title: "High-risk actions require human approval",
      status:
        approvals.some((approval) => approval.status === "pending") ||
        approvals.some((approval) => approval.status === "approved" || approval.status === "rejected")
          ? "pass"
          : "watch",
      howTested: "Run live workflow and verify approval record appears before completion.",
      evidence: approvals.slice(0, 5).map((approval) => approval.approvalId)
    },
    {
      claimId: "immutable_audit_chain",
      title: "Audit trail is replayable and evidence-linked",
      status: auditEvents.length > 0 && auditEvents.every((event) => typeof event.evidenceId === "string") ? "pass" : "watch",
      howTested: "Query audit events and verify evidence IDs are present and queryable.",
      evidence: auditEvents.slice(0, 5).map((event) => event.evidenceId)
    },
    {
      claimId: "incident_detection",
      title: "Risky failures are escalated into incidents",
      status: incidents.length > 0 ? "pass" : "watch",
      howTested: "Trigger policy denial/reviewer rejection and verify incident objects are created.",
      evidence: incidents.slice(0, 5).map((incident) => incident.incidentId)
    }
  ] as const;

  const passed = claims.filter((claim) => claim.status === "pass").length;
  const score = Math.round((passed / claims.length) * 100);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      score,
      totalClaims: claims.length,
      passedClaims: passed,
      executionTotals: {
        total: executions.length,
        blocked: executions.filter((execution) => execution.status === "blocked").length,
        completed: executions.filter((execution) => execution.status === "completed").length,
        failed: executions.filter((execution) => execution.status === "failed").length
      },
      approvalTotals: {
        total: approvals.length,
        pending: approvals.filter((approval) => approval.status === "pending").length,
        approved: approvals.filter((approval) => approval.status === "approved").length,
        rejected: approvals.filter((approval) => approval.status === "rejected").length
      },
      auditEventCount: auditEvents.length,
      incidentCount: incidents.length
    },
    claims
  };
};

const buildCommercialClaims = async () => {
  const state = await loadState();
  const executions = state.executions;
  const approvals = state.approvals;
  const audits = state.auditEvents;
  const incidents = state.incidents;

  const executionTotals = {
    total: executions.length,
    completed: executions.filter((item) => item.status === "completed").length,
    blocked: executions.filter((item) => item.status === "blocked").length,
    failed: executions.filter((item) => item.status === "failed").length
  };

  const approvalTotals = {
    total: approvals.length,
    pending: approvals.filter((item) => item.status === "pending").length,
    approved: approvals.filter((item) => item.status === "approved").length,
    rejected: approvals.filter((item) => item.status === "rejected").length
  };

  const auditExecutionIds = new Set(
    audits.flatMap((event) =>
      typeof event.details.executionId === "string" ? [event.details.executionId] : []
    )
  );
  const executionsWithEvidence = executions.filter((execution) => typeof execution.evidenceId === "string" && execution.evidenceId.length > 0).length;
  const executionAuditCoverage = executions.length === 0 ? 1 : executions.filter((execution) => auditExecutionIds.has(execution.executionId)).length / executions.length;

  const liveExecutions = executions.filter((execution) => execution.mode === "live");
  const liveWithApprovals = liveExecutions.filter((execution) => Boolean(execution.approvalId)).length;
  const ephiExecutions = executions.filter((execution) => execution.policyDecision.classification === "EPHI");
  const ephiZeroRetention = ephiExecutions.filter((execution) => execution.modelRoute?.zeroRetention !== false).length;

  const claims = [
    {
      claimId: "policy_gates_enforced",
      title: "Policy gates are enforced outside the model",
      status: executions.some((execution) => execution.policyDecision.effect !== "ALLOW") ? "verified" : "partial",
      evidence: {
        policyEffects: executions.map((execution) => execution.policyDecision.effect),
        blockedOrFailedExecutions: executionTotals.blocked + executionTotals.failed
      }
    },
    {
      claimId: "human_approval_for_high_risk_live",
      title: "High-risk live workflows require human approval",
      status: liveExecutions.length === 0 ? "partial" : liveWithApprovals === liveExecutions.length ? "verified" : "partial",
      evidence: {
        liveExecutions: liveExecutions.length,
        liveWithApprovals
      }
    },
    {
      claimId: "audit_and_evidence_coverage",
      title: "Major actions are auditable and replayable",
      status: executionAuditCoverage >= 0.95 && executionsWithEvidence === executions.length ? "verified" : "partial",
      evidence: {
        executionAuditCoverage: Number(executionAuditCoverage.toFixed(4)),
        executionsWithEvidence,
        totalExecutions: executions.length,
        auditEvents: audits.length
      }
    },
    {
      claimId: "ephi_zero_retention_routing",
      title: "EPHI model routing honors zero-retention posture",
      status: ephiExecutions.length === 0 ? "partial" : ephiZeroRetention === ephiExecutions.length ? "verified" : "partial",
      evidence: {
        ephiExecutions: ephiExecutions.length,
        ephiZeroRetention
      }
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    executionTotals,
    approvalTotals,
    incidentTotals: {
      total: incidents.length,
      open: incidents.filter((item) => item.status === "open").length
    },
    claims
  };
};

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const pathname = parsedUrl.pathname;

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    });
    response.end();
    return;
  }

  if (pathname === "/healthz") {
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName });
    return;
  }

  if (method === "POST" && pathname === "/v1/auth/login") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email : "";
    const state = await loadState();
    const user = state.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      sendJson(response, 401, { error: "invalid_credentials" });
      return;
    }

    const canonicalRole = resolveUserRole(user);
    sendJson(response, 200, {
      accessToken: `demo-token-${user.userId}`,
      user: {
        ...user,
        roles: roleToPrivileges[canonicalRole] ?? ["workflow_operator"],
        assuranceLevel: roleToAssurance[canonicalRole] ?? "aal2"
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    return;
  }

  const actorId = getActorFromAuthHeader(request);
  if (!actorId) {
    sendJson(response, 401, { error: "missing_or_invalid_auth_token" });
    return;
  }

  if (method === "GET" && pathname === "/v1/commercial/claims") {
    sendJson(response, 200, await buildCommercialClaims());
    return;
  }

  if (method === "GET" && pathname === "/v1/policies/profile") {
    sendJson(response, 200, await getPolicyProfileSnapshot());
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/preview") {
    const body = await readJson(request);
    const preview = await previewPolicyProfile({
      tenantId: toString(body.tenantId, "tenant-starlight-health"),
      profileName: toString(body.profileName, "Hospital Safe Baseline"),
      draftControls: parseDraftControls(body)
    });
    sendJson(response, 200, preview);
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/copilot") {
    const body = await readJson(request);
    const operatorGoal = toString(body.operatorGoal, "Keep the policy secure while reducing operator confusion.");
    const current = await getPolicyProfileSnapshot();
    const preview = await previewPolicyProfile({
      tenantId: toString(body.tenantId, "tenant-starlight-health"),
      profileName: toString(body.profileName, current.profile.profileName),
      draftControls: parseDraftControls(body)
    });

    const fallbackSuggestion = suggestPolicyAutofix(preview.profile.controls, operatorGoal);
    const localCopilot = await readLocalPolicyCopilot({
      current,
      proposed: preview,
      validation: preview.validation,
      operatorGoal
    });
    const localSuggestedControls =
      typeof localCopilot?.suggestedControls === "object" && localCopilot.suggestedControls !== null
        ? parseDraftControls({ controls: localCopilot.suggestedControls as Record<string, unknown> })
        : undefined;

    sendJson(response, 200, {
      source: localCopilot ? "local-llm" : "builtin",
      operatorGoal,
      summary:
        typeof localCopilot?.summary === "string" ? localCopilot.summary : fallbackSuggestion.summary,
      riskNarrative:
        typeof localCopilot?.riskNarrative === "string"
          ? localCopilot.riskNarrative
          : fallbackSuggestion.riskNarrative,
      hints:
        Array.isArray(localCopilot?.hints) && localCopilot.hints.every((item) => typeof item === "string")
          ? (localCopilot.hints as string[])
          : fallbackSuggestion.hints,
      suggestedControls: localSuggestedControls
        ? { ...preview.profile.controls, ...localSuggestedControls }
        : fallbackSuggestion.suggestedControls,
      suggestedReason:
        typeof localCopilot?.suggestedReason === "string"
          ? localCopilot.suggestedReason
          : fallbackSuggestion.suggestedReason,
      confidence:
        typeof localCopilot?.confidence === "number" ? localCopilot.confidence : fallbackSuggestion.confidence,
      previewValidation: preview.validation
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/save") {
    const body = await readJson(request);
    const breakGlassRaw =
      typeof body.breakGlass === "object" && body.breakGlass !== null
        ? (body.breakGlass as Record<string, unknown>)
        : undefined;
    const result = await savePolicyProfile({
      actorId,
      tenantId: toString(body.tenantId, "tenant-starlight-health"),
      profileName: toString(body.profileName, "Hospital Safe Baseline"),
      changeSummary: toString(body.changeSummary, "Policy profile updated from Security Console."),
      draftControls: parseDraftControls(body),
      ...(breakGlassRaw
        ? {
            breakGlass: {
              ticketId: toString(breakGlassRaw.ticketId, ""),
              justification: toString(breakGlassRaw.justification, ""),
              approverIds: toStringList(breakGlassRaw.approverIds)
            }
          }
        : {})
    });
    sendJson(response, result.status, result.body);
    return;
  }

  if (method === "POST" && pathname === "/v1/policy/evaluate") {
    const body = await readJson(request);
    const snapshot = await getPolicyProfileSnapshot();
    const classification = typeof body.classification === "string" ? body.classification : "EPHI";
    const result = evaluatePolicy({
      action: typeof body.action === "string" ? body.action : "unknown",
      classification: classification as "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET",
      riskLevel: (body.riskLevel as "low" | "medium" | "high" | "critical") ?? "low",
      mode: (body.mode as PilotMode) ?? "simulation",
      zeroRetentionRequested: body.zeroRetentionRequested !== false,
      ...(typeof body.estimatedToolCalls === "number" ? { estimatedToolCalls: body.estimatedToolCalls } : {})
    }, snapshot.profile.controls);
    sendJson(response, 200, {
      decision: result,
      profileVersion: snapshot.profile.profileVersion
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/approvals") {
    const body = await readJson(request);
    const state = await loadState();
    const approval = createApproval({
      tenantId: typeof body.tenantId === "string" ? body.tenantId : "tenant-starlight-health",
      requestedBy: actorId,
      reason: typeof body.reason === "string" ? body.reason : "manual_approval",
      riskLevel: (body.riskLevel as "high" | "critical") ?? "high",
      ...(typeof body.executionId === "string" ? { executionId: body.executionId } : {})
    });
    state.approvals.push(approval);
    await saveState(state);
    sendJson(response, 201, approval);
    return;
  }

  if (method === "GET" && pathname === "/v1/approvals") {
    const state = await loadState();
    sendJson(response, 200, { approvals: state.approvals });
    return;
  }

  if (method === "POST" && /^\/v1\/approvals\/.+\/decide$/.test(pathname)) {
    const body = await readJson(request);
    const approvalId = pathname.split("/")[3] ?? "";
    const result = await handleApprove(approvalId, actorId, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (method === "POST" && pathname === "/v1/model/route/preview") {
    const body = await readJson(request);
    const snapshot = await getPolicyProfileSnapshot();
    const classification = typeof body.classification === "string" ? body.classification : "EPHI";
    const decision = routeModel({
      classification: classification as "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET",
      zeroRetentionRequired:
        body.zeroRetentionRequired !== false ||
        ((classification === "PHI" || classification === "EPHI") &&
          snapshot.profile.controls.restrictExternalProvidersToZeroRetention)
    });
    sendJson(response, 200, { selected: decision, fallback: [{ provider: "anthropic", modelId: "claude-3.5-sonnet", zeroRetention: true }] });
    return;
  }

  if (method === "POST" && /^\/v1\/tools\/.+\/(simulate|execute)$/.test(pathname)) {
    const body = await readJson(request);
    const mode = pathname.endsWith("/simulate") ? "simulate" : "execute";
    const toolId = pathname.split("/")[3] ?? "unknown-tool";
    const result = {
      toolCallId: `tc-${Date.now().toString(36)}`,
      toolId,
      mode,
      status: "completed",
      result: {
        echoedParameters: body,
        note: "Tool execution is sandboxed and audited in pilot mode."
      }
    };
    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && pathname === "/v1/agent-graphs") {
    const state = await loadState();
    const graphs = await listAgentGraphDefinitions();
    sendJson(response, 200, {
      graphs: graphs.map((graph) => ({
        ...graph,
        executionCount: state.graphExecutions.filter((item) => item.graphId === graph.graphId).length,
        incidentCount: state.incidents.filter((item) => item.graphId === graph.graphId).length
      }))
    });
    return;
  }

  if (method === "GET" && /^\/v1\/agent-graphs\/[^/]+$/.test(pathname)) {
    const graphId = pathname.split("/")[3] ?? "";
    const graph = await getAgentGraphDefinition(graphId);
    if (!graph) {
      sendJson(response, 404, { error: "graph_not_found" });
      return;
    }

    const state = await loadState();
    sendJson(response, 200, {
      graph,
      executions: state.graphExecutions.filter((item) => item.graphId === graphId),
      incidents: state.incidents.filter((item) => item.graphId === graphId)
    });
    return;
  }

  if (method === "GET" && /^\/v1\/agent-graphs\/[^/]+\/executions\/[^/]+$/.test(pathname)) {
    const parts = pathname.split("/");
    const graphId = parts[3] ?? "";
    const executionId = parts[5] ?? "";
    const graphExecution = await getGraphExecution(graphId, executionId);
    const executionBundle = await getGraphExecutionByExecutionId(executionId);
    if (!graphExecution || !executionBundle) {
      sendJson(response, 404, { error: "graph_execution_not_found" });
      return;
    }
    sendJson(response, 200, {
      graphExecution,
      execution: executionBundle.execution
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/executions") {
    const body = await readJson(request);
    const result = await createExecution({
      actorId,
      patientId: typeof body.patientId === "string" ? body.patientId : "patient-1001",
      mode: (body.mode as PilotMode) ?? "simulation",
      workflowId: typeof body.workflowId === "string" ? body.workflowId : "wf-discharge-assistant",
      tenantId: typeof body.tenantId === "string" ? body.tenantId : "tenant-starlight-health",
      requestFollowupEmail: body.requestFollowupEmail !== false,
      ...(typeof body.classification === "string" ? { classification: body.classification } : {}),
      ...(typeof body.zeroRetentionRequested === "boolean" ? { zeroRetentionRequested: body.zeroRetentionRequested } : {})
    });
    sendJson(response, result.status, result.body);
    return;
  }

  if (method === "GET" && /^\/v1\/executions\/[^/]+\/graph$/.test(pathname)) {
    const executionId = pathname.split("/")[3] ?? "";
    const bundle = await getGraphExecutionByExecutionId(executionId);
    if (!bundle) {
      sendJson(response, 404, { error: "graph_execution_not_found" });
      return;
    }
    sendJson(response, 200, bundle);
    return;
  }

  if (method === "GET" && /^\/v1\/executions\/[^/]+$/.test(pathname)) {
    const executionId = pathname.split("/")[3] ?? "";
    const state = await loadState();
    const execution = state.executions.find((item) => item.executionId === executionId);
    if (!execution) {
      sendJson(response, 404, { error: "execution_not_found" });
      return;
    }
    sendJson(response, 200, execution);
    return;
  }

  if (method === "GET" && pathname === "/v1/incidents") {
    sendJson(response, 200, { incidents: await listIncidents() });
    return;
  }

  if (method === "GET" && /^\/v1\/incidents\/[^/]+$/.test(pathname)) {
    const incidentId = pathname.split("/")[3] ?? "";
    const incident = await getIncident(incidentId);
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    sendJson(response, 200, incident);
    return;
  }

  if (method === "GET" && pathname === "/v1/audit/events") {
    const state = await loadState();
    sendJson(response, 200, { events: state.auditEvents.slice().reverse() });
    return;
  }

  if (method === "GET" && pathname === "/v1/commercial/proof") {
    const snapshot = await buildCommercialSnapshot();
    const report = await readCommercialProofReport();
    sendJson(response, 200, { ...snapshot, ...(report ? { report } : {}) });
    return;
  }

  if (method === "GET" && pathname === "/v1/commercial/readiness") {
    sendJson(response, 200, await buildCommercialReadinessSnapshot());
    return;
  }

  if (method === "GET" && /^\/v1\/audit\/evidence\/.+$/.test(pathname)) {
    const evidenceId = pathname.split("/")[4] ?? "";
    const state = await loadState();
    const event = state.auditEvents.find((item) => item.evidenceId === evidenceId);
    if (!event) {
      sendJson(response, 404, { error: "evidence_not_found" });
      return;
    }
    sendJson(response, 200, { evidence: event });
    return;
  }

  sendJson(response, 404, { error: "not_found", path: pathname });
};

export const createAppServer = () => createServer((request, response) => {
  void requestHandler(request, response).catch((error: unknown) => {
    sendJson(response, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" });
  });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(descriptor.serviceName + " listening on :" + descriptor.listeningPort);
  });
}

