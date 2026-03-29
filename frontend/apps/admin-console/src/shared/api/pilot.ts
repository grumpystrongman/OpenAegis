export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  assuranceLevel: "aal1" | "aal2" | "aal3";
  tenantId: string;
}

export interface LoginResponse {
  accessToken: string;
  user: SessionUser;
  expiresAt: string;
}

export interface ExecutionRecord {
  executionId: string;
  workflowId: string;
  mode: "simulation" | "live";
  tenantId: string;
  actorId: string;
  patientId: string;
  status: "queued" | "running" | "blocked" | "completed" | "failed";
  currentStep: string;
  output?: {
    summary: string;
    recommendation: string;
    riskFlags: string[];
  };
  blockedReason?: string;
  approvalId?: string;
  modelRoute?: {
    provider: string;
    modelId: string;
    zeroRetention: boolean;
    reasonCodes?: string[];
  };
  toolCalls: string[];
  evidenceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  approvalId: string;
  executionId?: string;
  tenantId: string;
  requestedBy: string;
  reason: string;
  riskLevel: "high" | "critical";
  requiredApprovers: number;
  approvers: Array<{ approverId: string; decision: "approved" | "rejected"; reason?: string; decidedAt: string }>;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  expiresAt: string;
}

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  tenantId: string;
  actorId: string;
  category: string;
  action: string;
  status: "success" | "blocked" | "failure";
  details: Record<string, unknown>;
  evidenceId: string;
}

export interface ModelRoutePreview {
  provider: string;
  modelId: string;
  zeroRetention: boolean;
  reasonCodes?: string[];
  score?: {
    cost: number;
    latency: number;
    risk: number;
    total: number;
  };
}

const baseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3000";

const jsonRequest = async <T>(
  path: string,
  method: "GET" | "POST",
  accessToken?: string,
  body?: unknown
): Promise<T> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "request_failed" }));
    throw new Error(errorBody.error ?? "request_failed");
  }

  return (await response.json()) as T;
};

export const pilotApi = {
  login: (email: string) =>
    jsonRequest<LoginResponse>("/v1/auth/login", "POST", undefined, { email }),
  runExecution: (token: string, mode: "simulation" | "live", requestFollowupEmail: boolean) =>
    jsonRequest<ExecutionRecord>("/v1/executions", "POST", token, {
      workflowId: "wf-discharge-assistant",
      patientId: "patient-1001",
      mode,
      requestFollowupEmail
    }),
  getExecution: (token: string, executionId: string) =>
    jsonRequest<ExecutionRecord>(`/v1/executions/${executionId}`, "GET", token),
  listApprovals: (token: string) =>
    jsonRequest<{ approvals: ApprovalRecord[] }>("/v1/approvals", "GET", token),
  decideApproval: (token: string, approvalId: string, decision: "approve" | "reject", reason: string) =>
    jsonRequest<ApprovalRecord>(`/v1/approvals/${approvalId}/decide`, "POST", token, { decision, reason }),
  listAuditEvents: (token: string) =>
    jsonRequest<{ events: AuditEvent[] }>("/v1/audit/events", "GET", token),
  previewModelRoute: (token: string) =>
    jsonRequest<{ selected: ModelRoutePreview; fallback: ModelRoutePreview[] }>(
      "/v1/model/route/preview",
      "POST",
      token,
      { classification: "EPHI", zeroRetentionRequired: true }
    )
};
