import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@eaos/contracts";
import {
  createApproval,
  evaluatePolicy,
  getAgentGraphDefinition,
  getGraphExecution,
  getGraphExecutionByExecutionId,
  getIncident,
  listAgentGraphDefinitions,
  listIncidents,
  loadState,
  routeModel,
  resolveApprovalAndAdvanceExecution,
  saveState,
  startDischargeAssistantExecution,
  type PilotMode
} from "@eaos/pilot-core";

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

  if (method === "POST" && pathname === "/v1/policy/evaluate") {
    const body = await readJson(request);
    const classification = typeof body.classification === "string" ? body.classification : "EPHI";
    const result = evaluatePolicy({
      action: typeof body.action === "string" ? body.action : "unknown",
      classification: classification as "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET",
      riskLevel: (body.riskLevel as "low" | "medium" | "high" | "critical") ?? "low",
      mode: (body.mode as PilotMode) ?? "simulation",
      zeroRetentionRequested: body.zeroRetentionRequested !== false
    });
    sendJson(response, 200, result);
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
    const classification = typeof body.classification === "string" ? body.classification : "EPHI";
    const decision = routeModel({
      classification: classification as "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET",
      zeroRetentionRequired: body.zeroRetentionRequired !== false
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
