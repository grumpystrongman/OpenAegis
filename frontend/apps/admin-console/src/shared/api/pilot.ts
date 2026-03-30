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

export interface CommercialClaim {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail";
  evidence: Record<string, unknown>;
}

export interface CommercialProofSnapshot {
  generatedAt: string;
  live: {
    executions: number;
    approvals: number;
    auditEvents: number;
    graphExecutions: number;
    incidents: number;
  };
  claims: CommercialClaim[];
  report?: Record<string, unknown>;
}

export interface CommercialReadinessClaim {
  claimId: string;
  title: string;
  status: "pass" | "watch";
  howTested: string;
  evidence: string[];
}

export interface CommercialReadinessSnapshot {
  generatedAt: string;
  summary: {
    score: number;
    totalClaims: number;
    passedClaims: number;
    executionTotals: {
      total: number;
      blocked: number;
      completed: number;
      failed: number;
    };
    approvalTotals: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    auditEventCount: number;
    incidentCount: number;
  };
  claims: CommercialReadinessClaim[];
}

export interface CommercialVerificationClaim {
  claimId: string;
  title: string;
  status: "verified" | "partial";
  evidence: Record<string, unknown>;
}

export interface PolicyProfileControls {
  enforceSecretDeny: boolean;
  requireZeroRetentionForPhi: boolean;
  requireApprovalForHighRiskLive: boolean;
  requireDlpOnOutbound: boolean;
  restrictExternalProvidersToZeroRetention: boolean;
  maxToolCallsPerExecution: number;
}

export interface PolicyProfile {
  profileId: string;
  tenantId: string;
  profileName: string;
  profileVersion: number;
  controls: PolicyProfileControls;
  changeSummary: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PolicyValidationIssue {
  severity: "blocking" | "warning" | "info";
  code: string;
  title: string;
  message: string;
  remediation: string;
  affectedControls: Array<keyof PolicyProfileControls>;
}

export interface PolicySimulationResult {
  generatedAt: string;
  totals: {
    allow: number;
    requireApproval: number;
    deny: number;
  };
  riskyDeltaDetected: boolean;
  warnings: string[];
  scenarios: Array<{
    scenarioId: string;
    title: string;
    decision: {
      effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
      reasons: string[];
      obligations: string[];
    };
  }>;
}

export interface PolicyValidationResult {
  valid: boolean;
  issues: PolicyValidationIssue[];
  simulation: PolicySimulationResult;
}

export interface PolicyProfileSnapshot {
  profile: PolicyProfile;
  validation: PolicyValidationResult;
}

export interface PolicyCopilotReview {
  source: "local-llm" | "builtin";
  operatorGoal: string;
  summary: string;
  riskNarrative: string;
  hints: string[];
  suggestedControls: PolicyProfileControls;
  suggestedReason: string;
  confidence: number;
  previewValidation: PolicyValidationResult;
}

export interface CommercialClaimsSnapshot {
  generatedAt: string;
  executionTotals: {
    total: number;
    completed: number;
    blocked: number;
    failed: number;
  };
  approvalTotals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  incidentTotals: {
    total: number;
    open: number;
  };
  claims: CommercialVerificationClaim[];
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
  getCommercialProof: (token: string) =>
    jsonRequest<CommercialProofSnapshot>("/v1/commercial/proof", "GET", token),
  getCommercialClaims: (token: string) =>
    jsonRequest<CommercialClaimsSnapshot>("/v1/commercial/claims", "GET", token),
  previewModelRoute: (token: string) =>
    jsonRequest<{ selected: ModelRoutePreview; fallback: ModelRoutePreview[] }>(
      "/v1/model/route/preview",
      "POST",
      token,
      { classification: "EPHI", zeroRetentionRequired: true }
    ),
  getCommercialReadiness: (token: string) =>
    jsonRequest<CommercialReadinessSnapshot>("/v1/commercial/readiness", "GET", token),
  getPolicyProfile: (token: string) =>
    jsonRequest<PolicyProfileSnapshot>("/v1/policies/profile", "GET", token),
  previewPolicyProfile: (token: string, payload: { profileName?: string; controls: Partial<PolicyProfileControls> }) =>
    jsonRequest<PolicyProfileSnapshot>("/v1/policies/profile/preview", "POST", token, payload),
  reviewPolicyWithCopilot: (
    token: string,
    payload: { operatorGoal: string; profileName?: string; controls: Partial<PolicyProfileControls> }
  ) => jsonRequest<PolicyCopilotReview>("/v1/policies/profile/copilot", "POST", token, payload),
  savePolicyProfile: (
    token: string,
    payload: {
      profileName?: string;
      changeSummary: string;
      controls: Partial<PolicyProfileControls>;
      breakGlass?: { ticketId: string; justification: string; approverIds: string[] };
    }
  ) =>
    jsonRequest<{ profile: PolicyProfile; validation: PolicyValidationResult; breakGlassUsed: boolean }>(
      "/v1/policies/profile/save",
      "POST",
      token,
      payload
    )
};
