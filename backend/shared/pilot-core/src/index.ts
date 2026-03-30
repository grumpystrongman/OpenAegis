import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type PilotMode = "simulation" | "live";
export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
export type PolicyEffect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type GraphStageName = "planner" | "executor" | "reviewer";
export type GraphStepStatus = "completed" | "blocked" | "failed";
export type GraphExecutionStatus = "running" | "waiting_for_approval" | "completed" | "failed";
export type IncidentCategory = "policy_violation" | "review_rejection";
export type IncidentStatus = "open" | "triaged" | "resolved";

export interface ServiceUser {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string;
}

export interface FhirPatient {
  patientId: string;
  mrn: string;
  displayName: string;
  ward: string;
  readinessScore: number;
  diagnosis: string;
  riskFlags: string[];
  primaryCareProvider: string;
}

export interface CarePlan {
  patientId: string;
  summary: string;
  dischargeTargetDate: string;
  recommendedFollowupHours: number;
  medicationChanges: string[];
  supportNeeds: string[];
}

export interface ApprovalRecord {
  approvalId: string;
  tenantId: string;
  requestedBy: string;
  reason: string;
  riskLevel: "high" | "critical";
  requiredApprovers: number;
  approvers: Array<{
    approverId: string;
    decision: "approved" | "rejected";
    reason?: string;
    decidedAt: string;
  }>;
  status: ApprovalStatus;
  executionId?: string;
  decidedBy?: string;
  decisionReason?: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface ModelRouteDecision {
  provider: "self-hosted" | "azure-openai" | "anthropic" | "openai" | "google";
  modelId: string;
  zeroRetention: boolean;
  riskScore: number;
  latencyBudgetMs: number;
  explanation: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  action: string;
  classification: DataClassification;
  riskLevel: "low" | "medium" | "high" | "critical";
  mode: PilotMode;
  zeroRetentionRequested: boolean;
  reasons: string[];
  obligations: string[];
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

export interface PolicySimulationScenario {
  scenarioId: string;
  title: string;
  input: {
    action: string;
    classification: DataClassification;
    riskLevel: "low" | "medium" | "high" | "critical";
    mode: PilotMode;
    zeroRetentionRequested: boolean;
  };
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
    decision: PolicyDecision;
  }>;
}

export interface PolicyValidationResult {
  valid: boolean;
  issues: PolicyValidationIssue[];
  simulation: PolicySimulationResult;
}

export interface PolicyCopilotSuggestion {
  summary: string;
  riskNarrative: string;
  hints: string[];
  suggestedControls: PolicyProfileControls;
  suggestedReason: string;
  confidence: number;
}

export interface ToolCallRecord {
  toolCallId: string;
  executionId: string;
  toolId: string;
  action: "READ" | "WRITE" | "EXECUTE";
  status: "completed" | "blocked" | "failed";
  classification: DataClassification;
  resultRef: string;
  createdAt: string;
}

export interface AuditEventRecord {
  eventId: string;
  evidenceId: string;
  tenantId: string;
  actorId: string;
  category: "workflow" | "approval" | "incident" | "security";
  action: string;
  status: "success" | "blocked" | "failed";
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ExecutionOutput {
  summary: string;
  recommendation: string;
  riskFlags: string[];
}

export interface WorkflowExecutionRecord {
  executionId: string;
  graphExecutionId: string;
  graphId: string;
  workflowId: string;
  tenantId: string;
  actorId: string;
  patientId: string;
  mode: PilotMode;
  status: "blocked" | "completed" | "failed";
  currentStep: GraphStageName | "awaiting_approval" | "done" | "policy_denied" | "review_rejected";
  output: ExecutionOutput;
  blockedReason?: string;
  failureReason?: string;
  approvalId?: string;
  incidentId?: string;
  policyDecision: PolicyDecision;
  modelRoute?: ModelRouteDecision;
  toolCalls: string[];
  evidenceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGraphDefinition {
  graphId: string;
  workflowId: string;
  name: string;
  version: string;
  description: string;
  stages: Array<{
    stage: GraphStageName;
    purpose: string;
    requiredCapabilities: string[];
  }>;
}

export interface AgentGraphStepRecord {
  stepId: string;
  graphExecutionId: string;
  executionId: string;
  stage: GraphStageName;
  order: number;
  status: GraphStepStatus;
  startedAt: string;
  completedAt: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  previousHash: string | null;
  hash: string;
}

export interface AgentGraphExecutionRecord {
  graphExecutionId: string;
  graphId: string;
  workflowId: string;
  executionId: string;
  tenantId: string;
  actorId: string;
  patientId: string;
  mode: PilotMode;
  status: GraphExecutionStatus;
  currentStage: GraphStageName | "done" | "policy_denied" | "waiting_for_approval" | "review_rejected";
  steps: AgentGraphStepRecord[];
  policyDecision: PolicyDecision;
  context: {
    patientReadinessScore: number;
    requestFollowupEmail: boolean;
    classification: DataClassification;
    zeroRetentionRequested: boolean;
    riskLevel: "low" | "medium" | "high" | "critical";
    modelRoute?: ModelRouteDecision;
    toolCallIds: string[];
    planSummary: string;
    recommendation: string;
    riskFlags: string[];
  };
  approvalId?: string;
  incidentId?: string;
  blockedReason?: string;
  failureReason?: string;
  evidenceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentRecord {
  incidentId: string;
  tenantId: string;
  executionId: string;
  graphExecutionId: string;
  graphId: string;
  category: IncidentCategory;
  severity: "medium" | "high" | "critical";
  status: IncidentStatus;
  title: string;
  summary: string;
  sourceStage: GraphStageName | "planner";
  relatedStepIds: string[];
  evidenceId: string;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PilotState {
  version: number;
  users: ServiceUser[];
  fhirPatients: FhirPatient[];
  carePlans: CarePlan[];
  policyProfile: PolicyProfile;
  policyProfileHistory: PolicyProfile[];
  approvals: ApprovalRecord[];
  executions: WorkflowExecutionRecord[];
  toolCalls: ToolCallRecord[];
  auditEvents: AuditEventRecord[];
  graphDefinitions: AgentGraphDefinition[];
  graphExecutions: AgentGraphExecutionRecord[];
  incidents: IncidentRecord[];
}

interface WorkflowStartInput {
  actorId: string;
  patientId: string;
  mode: PilotMode;
  workflowId: string;
  tenantId: string;
  requestFollowupEmail: boolean;
  classification: DataClassification;
  zeroRetentionRequested: boolean;
}

interface WorkflowStartResult {
  state: PilotState;
  execution: WorkflowExecutionRecord;
  graphExecution: AgentGraphExecutionRecord;
  approval?: ApprovalRecord;
  incident?: IncidentRecord;
}

interface ReviewResult {
  approved: boolean;
  reason: string;
  incident?: IncidentRecord;
  reviewerStep: AgentGraphStepRecord;
}

const STATE_FILE = resolve(process.cwd(), ".volumes", "pilot-state.json");
const DEFAULT_GRAPH_ID = "discharge-assistant";
const DEFAULT_WORKFLOW_ID = "wf-discharge-assistant";

const defaultUsers: ServiceUser[] = [
  { userId: "user-clinician", email: "clinician@starlighthealth.org", displayName: "Dr. Mira Patel", role: "clinician", tenantId: "tenant-starlight-health" },
  { userId: "user-security", email: "security@starlighthealth.org", displayName: "Jordan Lee", role: "security", tenantId: "tenant-starlight-health" },
  { userId: "user-admin", email: "admin@starlighthealth.org", displayName: "Operations Admin", role: "admin", tenantId: "tenant-starlight-health" }
];

const defaultPatients: FhirPatient[] = [
  { patientId: "patient-1001", mrn: "MRN-1001", displayName: "Avery Johnson", ward: "Cardiology", readinessScore: 88, diagnosis: "Congestive heart failure", riskFlags: ["medication_reconciliation_complete"], primaryCareProvider: "Dr. Chen" },
  { patientId: "patient-2002", mrn: "MRN-2002", displayName: "Samir Khan", ward: "Internal Medicine", readinessScore: 46, diagnosis: "Pneumonia recovery", riskFlags: ["pending_lab_review", "needs_nursing_followup"], primaryCareProvider: "Dr. Rivera" }
];

const defaultCarePlans: CarePlan[] = [
  { patientId: "patient-1001", summary: "Discharge with heart failure action plan, daily weights, and cardiology follow-up.", dischargeTargetDate: "2026-04-02", recommendedFollowupHours: 48, medicationChanges: ["Increase furosemide to 40mg", "Continue carvedilol"], supportNeeds: ["home scale", "telehealth follow-up"] },
  { patientId: "patient-2002", summary: "Discharge deferred until pending labs and respiratory follow-up are complete.", dischargeTargetDate: "2026-04-05", recommendedFollowupHours: 24, medicationChanges: ["Complete antibiotic course", "Review oxygen need"], supportNeeds: ["family education", "lab result review"] }
];

const defaultGraphDefinitions = (): AgentGraphDefinition[] => [
  {
    graphId: DEFAULT_GRAPH_ID,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: "Hospital Discharge Assistant",
    version: "1.0.0",
    description: "Planner -> executor -> reviewer discharge workflow with policy gates and incident handling.",
    stages: [
      { stage: "planner", purpose: "Assemble the plan, policy context, and patient readiness profile.", requiredCapabilities: ["fhir.read", "sql.read", "policy.evaluate"] },
      { stage: "executor", purpose: "Execute approved read-only retrieval and draft the discharge summary.", requiredCapabilities: ["fhir.read", "sql.read", "model.infer"] },
      { stage: "reviewer", purpose: "Validate discharge readiness, create follow-up actions, and finalize disposition.", requiredCapabilities: ["policy.evaluate", "tool.write", "approval.handle"] }
    ]
  }
];

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
};

const hashRecord = (value: unknown): string => createHash("sha256").update(stableSerialize(value)).digest("hex");
const now = () => new Date().toISOString();
const createId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const defaultPolicyControls = (): PolicyProfileControls => ({
  enforceSecretDeny: true,
  requireZeroRetentionForPhi: true,
  requireApprovalForHighRiskLive: true,
  requireDlpOnOutbound: true,
  restrictExternalProvidersToZeroRetention: true,
  maxToolCallsPerExecution: 8
});

export const createDefaultPolicyProfile = (tenantId = "tenant-starlight-health"): PolicyProfile => ({
  profileId: "policy-profile-default",
  tenantId,
  profileName: "Hospital Safe Baseline",
  profileVersion: 1,
  controls: defaultPolicyControls(),
  changeSummary: "Initial secure baseline policy profile.",
  updatedBy: "system",
  updatedAt: now()
});

const defaultPolicyScenarios = (): PolicySimulationScenario[] => [
  {
    scenarioId: "s-safe-sim",
    title: "Simulation with EPHI and zero-retention on",
    input: {
      action: "workflow.execute",
      classification: "EPHI",
      riskLevel: "medium",
      mode: "simulation",
      zeroRetentionRequested: true
    }
  },
  {
    scenarioId: "s-high-live",
    title: "Live high-risk follow-up action",
    input: {
      action: "workflow.execute",
      classification: "EPHI",
      riskLevel: "high",
      mode: "live",
      zeroRetentionRequested: true
    }
  },
  {
    scenarioId: "s-ephi-no-retention",
    title: "EPHI with zero-retention disabled",
    input: {
      action: "workflow.execute",
      classification: "EPHI",
      riskLevel: "high",
      mode: "live",
      zeroRetentionRequested: false
    }
  },
  {
    scenarioId: "s-secret",
    title: "SECRET classification outbound request",
    input: {
      action: "tool.execute",
      classification: "SECRET",
      riskLevel: "critical",
      mode: "live",
      zeroRetentionRequested: true
    }
  }
];

const emptyState = (): PilotState => ({
  version: 1,
  users: defaultUsers,
  fhirPatients: defaultPatients,
  carePlans: defaultCarePlans,
  policyProfile: createDefaultPolicyProfile(),
  policyProfileHistory: [],
  approvals: [],
  executions: [],
  toolCalls: [],
  auditEvents: [],
  graphDefinitions: defaultGraphDefinitions(),
  graphExecutions: [],
  incidents: []
});

const normalizeState = (state: Partial<PilotState> | undefined): PilotState => {
  const base = emptyState();
  const normalizedProfile =
    state?.policyProfile
      ? {
          ...base.policyProfile,
          ...state.policyProfile,
          controls: mergePolicyControls(base.policyProfile.controls, state.policyProfile.controls ?? {})
        }
      : base.policyProfile;
  return {
    ...base,
    ...(state ?? {}),
    users: state?.users ?? base.users,
    fhirPatients: state?.fhirPatients ?? base.fhirPatients,
    carePlans: state?.carePlans ?? base.carePlans,
    policyProfile: normalizedProfile,
    policyProfileHistory: state?.policyProfileHistory ?? base.policyProfileHistory,
    approvals: state?.approvals ?? base.approvals,
    executions: state?.executions ?? base.executions,
    toolCalls: state?.toolCalls ?? base.toolCalls,
    auditEvents: state?.auditEvents ?? base.auditEvents,
    graphDefinitions: state?.graphDefinitions ?? base.graphDefinitions,
    graphExecutions: state?.graphExecutions ?? base.graphExecutions,
    incidents: state?.incidents ?? base.incidents
  };
};

export const defaultState = (): PilotState => normalizeState(undefined);

export const loadState = async (): Promise<PilotState> => {
  try {
    return normalizeState(JSON.parse(await readFile(STATE_FILE, "utf8")) as Partial<PilotState>);
  } catch {
    return defaultState();
  }
};

export const saveState = async (state: PilotState): Promise<void> => {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

export const mergePolicyControls = (
  current: PolicyProfileControls,
  draft: Partial<PolicyProfileControls>
): PolicyProfileControls => ({
  enforceSecretDeny: draft.enforceSecretDeny ?? current.enforceSecretDeny,
  requireZeroRetentionForPhi: draft.requireZeroRetentionForPhi ?? current.requireZeroRetentionForPhi,
  requireApprovalForHighRiskLive: draft.requireApprovalForHighRiskLive ?? current.requireApprovalForHighRiskLive,
  requireDlpOnOutbound: draft.requireDlpOnOutbound ?? current.requireDlpOnOutbound,
  restrictExternalProvidersToZeroRetention:
    draft.restrictExternalProvidersToZeroRetention ?? current.restrictExternalProvidersToZeroRetention,
  maxToolCallsPerExecution: Number.isFinite(draft.maxToolCallsPerExecution)
    ? Math.max(1, Math.floor(draft.maxToolCallsPerExecution as number))
    : current.maxToolCallsPerExecution
});

const isPhiLike = (classification: DataClassification) => classification === "PHI" || classification === "EPHI";
const isHighRisk = (riskLevel: "low" | "medium" | "high" | "critical") => riskLevel === "high" || riskLevel === "critical";

export const evaluatePolicy = (
  input: {
    action: string;
    classification: DataClassification;
    riskLevel: "low" | "medium" | "high" | "critical";
    mode: PilotMode;
    zeroRetentionRequested: boolean;
    estimatedToolCalls?: number;
  },
  controls: PolicyProfileControls = defaultPolicyControls()
): PolicyDecision => {
  const reasons: string[] = [];
  const obligations: string[] = ["log_audit_event", "classify_output"];
  let effect: PolicyEffect = "ALLOW";

  if (controls.enforceSecretDeny && input.classification === "SECRET") {
    effect = "DENY";
    reasons.push("secret_data_must_not_leave_trusted_boundary");
  }
  if (controls.requireZeroRetentionForPhi && isPhiLike(input.classification) && input.zeroRetentionRequested === false) {
    effect = "DENY";
    reasons.push("phi_or_ephi_requires_zero_retention_for_external_model_routing");
  }
  if (effect !== "DENY" && controls.requireApprovalForHighRiskLive && input.mode === "live" && isHighRisk(input.riskLevel)) {
    effect = "REQUIRE_APPROVAL";
    reasons.push("high_risk_live_action_requires_human_approval");
    obligations.push("human_approval");
  }
  if (controls.requireDlpOnOutbound && input.mode === "live") {
    obligations.push("dlp_scan_required");
  }
  if (controls.restrictExternalProvidersToZeroRetention && isPhiLike(input.classification)) {
    obligations.push("route_to_zero_retention_provider");
  }
  if (
    typeof input.estimatedToolCalls === "number" &&
    input.estimatedToolCalls > controls.maxToolCallsPerExecution
  ) {
    effect = "DENY";
    reasons.push("estimated_tool_calls_exceed_policy_budget");
  }
  if (effect === "ALLOW" && input.mode === "live" && input.classification === "EPHI") {
    obligations.push("zero_retention_enforced");
  }

  return { effect, action: input.action, classification: input.classification, riskLevel: input.riskLevel, mode: input.mode, zeroRetentionRequested: input.zeroRetentionRequested, reasons, obligations };
};

export const simulatePolicyProfile = (
  controls: PolicyProfileControls,
  scenarios: PolicySimulationScenario[] = defaultPolicyScenarios()
): PolicySimulationResult => {
  const scenarioResults = scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    decision: evaluatePolicy(scenario.input, controls)
  }));

  const totals = {
    allow: scenarioResults.filter((item) => item.decision.effect === "ALLOW").length,
    requireApproval: scenarioResults.filter((item) => item.decision.effect === "REQUIRE_APPROVAL").length,
    deny: scenarioResults.filter((item) => item.decision.effect === "DENY").length
  };

  const warnings: string[] = [];
  const secretScenario = scenarioResults.find((scenario) => scenario.scenarioId === "s-secret");
  if (secretScenario && secretScenario.decision.effect !== "DENY") {
    warnings.push("Secret-classification requests are no longer denied by default.");
  }
  const ephiScenario = scenarioResults.find((scenario) => scenario.scenarioId === "s-ephi-no-retention");
  if (ephiScenario && ephiScenario.decision.effect !== "DENY") {
    warnings.push("EPHI requests without zero-retention are no longer blocked.");
  }
  const highRiskScenario = scenarioResults.find((scenario) => scenario.scenarioId === "s-high-live");
  if (highRiskScenario && highRiskScenario.decision.effect !== "REQUIRE_APPROVAL") {
    warnings.push("Live high-risk actions no longer require human approval.");
  }
  if (controls.maxToolCallsPerExecution > 12) {
    warnings.push("Tool call budget above 12 increases blast radius for misconfigured workflows.");
  }

  return {
    generatedAt: now(),
    totals,
    riskyDeltaDetected: warnings.length > 0,
    warnings,
    scenarios: scenarioResults
  };
};

export const validatePolicyControls = (controls: PolicyProfileControls): PolicyValidationIssue[] => {
  const issues: PolicyValidationIssue[] = [];

  if (!controls.enforceSecretDeny) {
    issues.push({
      severity: "blocking",
      code: "secret_deny_disabled",
      title: "Secret deny control is disabled",
      message: "SECRET-classified requests would no longer be denied automatically.",
      remediation: "Enable \"enforceSecretDeny\".",
      affectedControls: ["enforceSecretDeny"]
    });
  }

  if (!controls.requireZeroRetentionForPhi) {
    issues.push({
      severity: "blocking",
      code: "zero_retention_phi_disabled",
      title: "Zero-retention safeguard is disabled for PHI/EPHI",
      message: "PHI/EPHI could be routed without zero-retention guarantees.",
      remediation: "Enable \"requireZeroRetentionForPhi\".",
      affectedControls: ["requireZeroRetentionForPhi"]
    });
  }

  if (!controls.requireApprovalForHighRiskLive) {
    issues.push({
      severity: "warning",
      code: "high_risk_approval_disabled",
      title: "High-risk live approvals are disabled",
      message: "Live high-risk actions may execute without human review.",
      remediation: "Enable \"requireApprovalForHighRiskLive\" unless a break-glass process is approved.",
      affectedControls: ["requireApprovalForHighRiskLive"]
    });
  }

  if (!controls.requireDlpOnOutbound) {
    issues.push({
      severity: "warning",
      code: "outbound_dlp_disabled",
      title: "Outbound DLP scan is disabled",
      message: "Sensitive output may leave the system without redaction checks.",
      remediation: "Enable \"requireDlpOnOutbound\".",
      affectedControls: ["requireDlpOnOutbound"]
    });
  }

  if (controls.maxToolCallsPerExecution < 3 || controls.maxToolCallsPerExecution > 20) {
    issues.push({
      severity: "blocking",
      code: "tool_budget_out_of_range",
      title: "Tool call budget is outside safe range",
      message: "maxToolCallsPerExecution must stay between 3 and 20.",
      remediation: "Set maxToolCallsPerExecution between 3 and 20.",
      affectedControls: ["maxToolCallsPerExecution"]
    });
  } else if (controls.maxToolCallsPerExecution > 12) {
    issues.push({
      severity: "warning",
      code: "tool_budget_high",
      title: "Tool call budget is high",
      message: "Higher tool budgets increase accidental data exposure blast radius.",
      remediation: "Lower maxToolCallsPerExecution to 12 or less for regulated workloads.",
      affectedControls: ["maxToolCallsPerExecution"]
    });
  }

  return issues;
};

export const evaluatePolicyProfileReadiness = (controls: PolicyProfileControls): PolicyValidationResult => {
  const issues = validatePolicyControls(controls);
  const simulation = simulatePolicyProfile(controls);
  return {
    valid: !issues.some((issue) => issue.severity === "blocking"),
    issues,
    simulation
  };
};

export const suggestPolicyAutofix = (
  controls: PolicyProfileControls,
  riskContext = "No additional user context provided."
): PolicyCopilotSuggestion => {
  const fixed: PolicyProfileControls = {
    ...controls,
    enforceSecretDeny: true,
    requireZeroRetentionForPhi: true,
    requireApprovalForHighRiskLive: true,
    requireDlpOnOutbound: true,
    restrictExternalProvidersToZeroRetention: true,
    maxToolCallsPerExecution: Math.min(12, Math.max(6, controls.maxToolCallsPerExecution))
  };

  const hints = [
    "Keep SECRET auto-deny enabled at all times.",
    "For PHI/EPHI, require zero-retention and human approval on high-risk live actions.",
    "Use simulation first, then apply the profile only after impact preview looks safe.",
    "If a warning remains, create a break-glass ticket before go-live."
  ];

  return {
    summary: "Copilot recommends restoring all critical safeguards and keeping a moderate tool budget.",
    riskNarrative: `The proposed profile can change approval and deny behavior. ${riskContext}`,
    hints,
    suggestedControls: fixed,
    suggestedReason: "Autofix hardened the policy profile to regulated-safe defaults while preserving operational usability.",
    confidence: 0.86
  };
};

export interface BreakGlassOverrideInput {
  ticketId: string;
  justification: string;
  approverIds: string[];
}

export interface PolicyProfileSnapshot {
  profile: PolicyProfile;
  validation: PolicyValidationResult;
}

export interface SavePolicyProfileInput {
  actorId: string;
  tenantId: string;
  profileName?: string;
  changeSummary: string;
  draftControls: Partial<PolicyProfileControls>;
  breakGlass?: BreakGlassOverrideInput;
}

const canManagePolicy = (user: ServiceUser | undefined) => user?.role === "security" || user?.role === "admin";

const isValidBreakGlass = (input: BreakGlassOverrideInput | undefined) => {
  if (!input) return false;
  const approvers = Array.from(new Set(input.approverIds.filter((id) => id.trim().length > 0)));
  return (
    typeof input.ticketId === "string" &&
    input.ticketId.trim().length > 4 &&
    typeof input.justification === "string" &&
    input.justification.trim().length >= 20 &&
    approvers.length >= 2
  );
};

const createProfileSnapshot = (profile: PolicyProfile): PolicyProfileSnapshot => ({
  profile,
  validation: evaluatePolicyProfileReadiness(profile.controls)
});

export const getPolicyProfileSnapshot = async (): Promise<PolicyProfileSnapshot> => {
  const state = await loadState();
  return createProfileSnapshot(state.policyProfile);
};

export const previewPolicyProfile = async (input: {
  tenantId: string;
  draftControls: Partial<PolicyProfileControls>;
  profileName?: string;
}): Promise<PolicyProfileSnapshot> => {
  const state = await loadState();
  const mergedControls = mergePolicyControls(state.policyProfile.controls, input.draftControls);
  const previewProfile: PolicyProfile = {
    ...state.policyProfile,
    tenantId: input.tenantId,
    profileName: input.profileName ?? state.policyProfile.profileName,
    controls: mergedControls
  };
  return createProfileSnapshot(previewProfile);
};

export const savePolicyProfile = async (
  input: SavePolicyProfileInput
): Promise<
  | { status: 200; body: { profile: PolicyProfile; validation: PolicyValidationResult; breakGlassUsed: boolean } }
  | { status: 403; body: { error: string } }
  | { status: 422; body: { error: string; validation: PolicyValidationResult } }
> => {
  const state = await loadState();
  const actor = state.users.find((user) => user.userId === input.actorId);
  if (!canManagePolicy(actor)) {
    return { status: 403, body: { error: "insufficient_role_for_policy_change" } };
  }

  const mergedControls = mergePolicyControls(state.policyProfile.controls, input.draftControls);
  const validation = evaluatePolicyProfileReadiness(mergedControls);
  const hasBlockingIssues = !validation.valid;
  const breakGlassUsed = hasBlockingIssues;

  if (hasBlockingIssues && !isValidBreakGlass(input.breakGlass)) {
    return {
      status: 422,
      body: {
        error: "break_glass_required_for_blocking_policy_changes",
        validation
      }
    };
  }

  const nextProfile: PolicyProfile = {
    ...state.policyProfile,
    tenantId: input.tenantId,
    profileName: input.profileName ?? state.policyProfile.profileName,
    profileVersion: state.policyProfile.profileVersion + 1,
    controls: mergedControls,
    changeSummary: input.changeSummary,
    updatedBy: input.actorId,
    updatedAt: now()
  };

  state.policyProfileHistory.unshift(state.policyProfile);
  state.policyProfile = nextProfile;
  state.auditEvents.push(
    createAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      category: "security",
      action: "policy_profile_updated",
      status: "success",
      details: {
        profileVersion: nextProfile.profileVersion,
        breakGlassUsed,
        changeSummary: input.changeSummary,
        issues: validation.issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code
        })),
        breakGlass: input.breakGlass ?? null
      }
    })
  );
  await persistState(state);

  return {
    status: 200,
    body: {
      profile: nextProfile,
      validation,
      breakGlassUsed
    }
  };
};

export const routeModel = (input: { classification: DataClassification; zeroRetentionRequired: boolean; }): ModelRouteDecision =>
  input.zeroRetentionRequired
    ? { provider: "self-hosted", modelId: "llama-3.1-70b-instruct", zeroRetention: true, riskScore: 0.12, latencyBudgetMs: 3500, explanation: "Prefer self-hosted route for sensitive or zero-retention workloads." }
    : { provider: "anthropic", modelId: "claude-3.5-sonnet", zeroRetention: false, riskScore: 0.38, latencyBudgetMs: 3000, explanation: `Fallback vendor route selected for ${input.classification} workload.` };

export const createApproval = (input: { tenantId: string; requestedBy: string; reason: string; riskLevel: "high" | "critical"; executionId?: string; }): ApprovalRecord => {
  const timestamp = now();
  return {
    approvalId: createId("ap"),
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    reason: input.reason,
    riskLevel: input.riskLevel,
    requiredApprovers: 1,
    approvers: [],
    status: "pending",
    ...(input.executionId ? { executionId: input.executionId } : {}),
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    updatedAt: timestamp
  };
};

export const applyApprovalDecision = (approval: ApprovalRecord, input: { approverId: string; decision: ApprovalStatus; reason?: string; }): ApprovalRecord => ({
  ...approval,
  status: input.decision,
  decidedBy: input.approverId,
  ...(input.reason ? { decisionReason: input.reason } : {}),
  approvers: [
    ...(Array.isArray(approval.approvers) ? approval.approvers : []),
    {
      approverId: input.approverId,
      decision: input.decision === "approved" ? "approved" : "rejected",
      ...(input.reason ? { reason: input.reason } : {}),
      decidedAt: now()
    }
  ],
  updatedAt: now()
});

export const createToolCall = (input: { executionId: string; toolId: string; action: "READ" | "WRITE" | "EXECUTE"; status: "completed" | "blocked" | "failed"; classification: DataClassification; resultRef: string; }): ToolCallRecord => ({
  toolCallId: createId("tc"),
  executionId: input.executionId,
  toolId: input.toolId,
  action: input.action,
  status: input.status,
  classification: input.classification,
  resultRef: input.resultRef,
  createdAt: now()
});

export const createAuditEvent = (input: { tenantId: string; actorId: string; category: "workflow" | "approval" | "incident" | "security"; action: string; status: "success" | "blocked" | "failed"; details: Record<string, unknown>; }): AuditEventRecord => ({
  eventId: createId("ae"),
  evidenceId: createId("ev"),
  tenantId: input.tenantId,
  actorId: input.actorId,
  category: input.category,
  action: input.action,
  status: input.status,
  details: input.details,
  createdAt: now()
});

export const buildDischargeSummary = (patient: FhirPatient, carePlan: CarePlan): ExecutionOutput => {
  const riskFlags = Array.isArray(patient.riskFlags) ? [...patient.riskFlags] : [];
  if (patient.readinessScore < 70) riskFlags.push("low_readiness");
  return {
    summary: `${patient.displayName} (${patient.mrn}) in ${patient.ward} can follow the plan: ${carePlan.summary}`,
    recommendation: patient.readinessScore >= 70 ? "Discharge is recommended with follow-up instructions and monitoring." : "Discharge should wait for reviewer approval and additional clinical review.",
    riskFlags
  };
};

const buildGraphStep = (input: {
  graphExecutionId: string;
  executionId: string;
  stage: GraphStageName;
  order: number;
  status: GraphStepStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  previousHash: string | null;
  startedAt?: string;
  completedAt?: string;
}): AgentGraphStepRecord => {
  const startedAt = input.startedAt ?? now();
  const completedAt = input.completedAt ?? startedAt;
  const hashPayload = {
    graphExecutionId: input.graphExecutionId,
    executionId: input.executionId,
    stage: input.stage,
    order: input.order,
    status: input.status,
    inputs: input.inputs,
    outputs: input.outputs,
    previousHash: input.previousHash
  };
  return {
    stepId: createId(`step-${input.stage}`),
    graphExecutionId: input.graphExecutionId,
    executionId: input.executionId,
    stage: input.stage,
    order: input.order,
    status: input.status,
    startedAt,
    completedAt,
    inputs: input.inputs,
    outputs: input.outputs,
    previousHash: input.previousHash,
    hash: hashRecord(hashPayload)
  };
};

const createIncident = (input: {
  tenantId: string;
  executionId: string;
  graphExecutionId: string;
  graphId: string;
  category: IncidentCategory;
  severity: "medium" | "high" | "critical";
  title: string;
  summary: string;
  sourceStage: GraphStageName | "planner";
  relatedStepIds: string[];
  evidenceId: string;
  details: Record<string, unknown>;
}): IncidentRecord => {
  const timestamp = now();
  return {
    incidentId: createId("inc"),
    tenantId: input.tenantId,
    executionId: input.executionId,
    graphExecutionId: input.graphExecutionId,
    graphId: input.graphId,
    category: input.category,
    severity: input.severity,
    status: "open",
    title: input.title,
    summary: input.summary,
    sourceStage: input.sourceStage,
    relatedStepIds: input.relatedStepIds,
    evidenceId: input.evidenceId,
    details: input.details,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const getGraphDefinition = (state: PilotState, graphId: string): AgentGraphDefinition | undefined =>
  state.graphDefinitions.find((item) => item.graphId === graphId);

const toString = (value: unknown, fallback: string): string => (typeof value === "string" && value.trim().length > 0 ? value : fallback);
const toNumber = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const toStringArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;

const normalizePatientRecord = (value: unknown): FhirPatient | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const patientId = toString(record.patientId, "");
  if (!patientId) return undefined;

  return {
    patientId,
    mrn: toString(record.mrn, `MRN-${patientId}`),
    displayName: toString(record.displayName ?? record.name, "Unknown patient"),
    ward: toString(record.ward, "General"),
    readinessScore: toNumber(record.readinessScore ?? record.dischargeReadinessScore, 70),
    diagnosis: toString(record.diagnosis, "Not specified"),
    riskFlags: toStringArray(record.riskFlags, ["standard_monitoring"]),
    primaryCareProvider: toString(record.primaryCareProvider ?? record.attendingPhysician, "Unassigned")
  };
};

const normalizeCarePlanRecord = (value: unknown, patientId: string): CarePlan | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const planPatientId = toString(record.patientId, "");
  if (planPatientId !== patientId) return undefined;

  const tasks = toStringArray(record.tasks, []);
  const pendingLabs = toStringArray(record.pendingLabs, []);

  return {
    patientId,
    summary: toString(
      record.summary,
      tasks.length > 0 ? `Care plan tasks: ${tasks.join("; ")}` : "Care plan summary unavailable."
    ),
    dischargeTargetDate: toString(record.dischargeTargetDate, new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10)),
    recommendedFollowupHours: toNumber(record.recommendedFollowupHours, 48),
    medicationChanges: toStringArray(record.medicationChanges, pendingLabs.length > 0 ? pendingLabs : ["No medication changes provided"]),
    supportNeeds: toStringArray(record.supportNeeds, tasks.length > 0 ? tasks : ["Follow clinical discharge protocol"])
  };
};

const getPatientBundle = (state: PilotState, patientId: string) => {
  const rawPatient = state.fhirPatients.find((item) => item.patientId === patientId) as unknown;
  const rawCarePlan = state.carePlans.find((item) => item.patientId === patientId) as unknown;

  return {
    patient: normalizePatientRecord(rawPatient),
    carePlan: normalizeCarePlanRecord(rawCarePlan, patientId)
  };
};

const persistState = async (state: PilotState): Promise<PilotState> => {
  await saveState(state);
  return state;
};

const addExecutionAndGraph = (state: PilotState, execution: WorkflowExecutionRecord, graphExecution: AgentGraphExecutionRecord): void => {
  state.executions.push(execution);
  state.graphExecutions.push(graphExecution);
};

const getExecutionAndGraph = (state: PilotState, executionId: string) => ({
  execution: state.executions.find((item) => item.executionId === executionId),
  graphExecution: state.graphExecutions.find((item) => item.executionId === executionId)
});

const createPolicyViolationIncident = (state: PilotState, input: {
  tenantId: string;
  actorId: string;
  executionId: string;
  graphExecutionId: string;
  graphId: string;
  evidenceId: string;
  policyDecision: PolicyDecision;
  plannerStepId: string;
}): IncidentRecord => {
  const incident = createIncident({
    tenantId: input.tenantId,
    executionId: input.executionId,
    graphExecutionId: input.graphExecutionId,
    graphId: input.graphId,
    category: "policy_violation",
    severity: "critical",
    title: "Policy violation blocked agent graph",
    summary: input.policyDecision.reasons.join("; ") || "Policy denied execution.",
    sourceStage: "planner",
    relatedStepIds: [input.plannerStepId],
    evidenceId: input.evidenceId,
    details: { policyDecision: input.policyDecision }
  });
  state.incidents.push(incident);
  state.auditEvents.push(createAuditEvent({
    tenantId: input.tenantId,
    actorId: input.actorId,
    category: "incident",
    action: "incident_created",
    status: "blocked",
    details: { incidentId: incident.incidentId, category: incident.category, executionId: incident.executionId }
  }));
  return incident;
};

const createReviewerRejectionIncident = (state: PilotState, input: {
  tenantId: string;
  actorId: string;
  executionId: string;
  graphExecutionId: string;
  graphId: string;
  evidenceId: string;
  reviewerStepId: string;
  reason: string;
  details: Record<string, unknown>;
}): IncidentRecord => {
  const incident = createIncident({
    tenantId: input.tenantId,
    executionId: input.executionId,
    graphExecutionId: input.graphExecutionId,
    graphId: input.graphId,
    category: "review_rejection",
    severity: "high",
    title: "Reviewer rejected discharge workflow",
    summary: input.reason,
    sourceStage: "reviewer",
    relatedStepIds: [input.reviewerStepId],
    evidenceId: input.evidenceId,
    details: input.details
  });
  state.incidents.push(incident);
  state.auditEvents.push(createAuditEvent({
    tenantId: input.tenantId,
    actorId: input.actorId,
    category: "incident",
    action: "incident_created",
    status: "blocked",
    details: { incidentId: incident.incidentId, category: incident.category, executionId: incident.executionId }
  }));
  return incident;
};

const buildPlannerStep = (input: {
  graphExecutionId: string;
  executionId: string;
  patient: FhirPatient;
  carePlan: CarePlan;
  policyDecision: PolicyDecision;
}): AgentGraphStepRecord => buildGraphStep({
  graphExecutionId: input.graphExecutionId,
  executionId: input.executionId,
  stage: "planner",
  order: 1,
  status: input.policyDecision.effect === "DENY" ? "blocked" : "completed",
  inputs: {
    patientId: input.patient.patientId,
    readinessScore: input.patient.readinessScore,
    diagnosis: input.patient.diagnosis,
    carePlan: input.carePlan.summary,
    mode: input.policyDecision.mode,
    classification: input.policyDecision.classification
  },
  outputs: {
    nextStage: "executor",
    planSummary: `Planner accepted ${input.patient.displayName} discharge review and queued retrievals.`,
    policyEffect: input.policyDecision.effect
  },
  previousHash: null
});

const buildExecutorStep = (input: {
  graphExecutionId: string;
  executionId: string;
  patient: FhirPatient;
  carePlan: CarePlan;
  output: ExecutionOutput;
  modelRoute: ModelRouteDecision;
  toolCalls: string[];
}): AgentGraphStepRecord => buildGraphStep({
  graphExecutionId: input.graphExecutionId,
  executionId: input.executionId,
  stage: "executor",
  order: 2,
  status: "completed",
  inputs: { patientId: input.patient.patientId, toolIds: ["fhir.read-patient", "sql.read-care-plan", "model.generate-discharge-summary"] },
  outputs: { toolCalls: input.toolCalls, modelRoute: input.modelRoute, output: input.output, carePlanSummary: input.carePlan.summary },
  previousHash: null
});

const buildReviewerStep = (input: {
  graphExecutionId: string;
  executionId: string;
  output: ExecutionOutput;
  patient: FhirPatient;
  previousHash: string | null;
  approvalId?: string;
}): ReviewResult => {
  const approved = input.patient.readinessScore >= 70 && !input.output.riskFlags.includes("low_readiness");
  const reason = approved ? "Reviewer approved discharge workflow." : "Reviewer rejected discharge workflow due to low readiness or active risk flags.";
  const reviewerStep = buildGraphStep({
    graphExecutionId: input.graphExecutionId,
    executionId: input.executionId,
    stage: "reviewer",
    order: 3,
    status: approved ? "completed" : "failed",
    inputs: { patientId: input.patient.patientId, readinessScore: input.patient.readinessScore, riskFlags: input.output.riskFlags, approvalId: input.approvalId ?? null },
    outputs: { decision: approved ? "approved" : "rejected", reason },
    previousHash: input.previousHash
  });
  return { approved, reason, reviewerStep };
};

const finalizeApprovedExecution = (state: PilotState, input: {
  execution: WorkflowExecutionRecord;
  graphExecution: AgentGraphExecutionRecord;
  patient: FhirPatient;
  carePlan: CarePlan;
  actorId: string;
  tenantId: string;
  requestFollowupEmail: boolean;
  policyDecision: PolicyDecision;
  approvalId?: string;
}): ReviewResult => {
  const previousHash = input.graphExecution.steps.length > 0 ? input.graphExecution.steps[input.graphExecution.steps.length - 1]!.hash : null;
  const review = buildReviewerStep({
    graphExecutionId: input.graphExecution.graphExecutionId,
    executionId: input.execution.executionId,
    output: input.execution.output,
    patient: input.patient,
    previousHash,
    ...(input.approvalId ? { approvalId: input.approvalId } : {})
  });
  input.graphExecution.steps.push(review.reviewerStep);
  input.graphExecution.updatedAt = now();

  if (review.approved) {
    if (input.requestFollowupEmail) {
      const emailToolCall = createToolCall({
        executionId: input.execution.executionId,
        toolId: "email.send-followup",
        action: "EXECUTE",
        status: "completed",
        classification: "PII",
        resultRef: `obj://tenant-starlight-health/executions/${input.execution.executionId}/followup-email.json`
      });
      state.toolCalls.push(emailToolCall);
      input.execution.toolCalls.push(emailToolCall.toolCallId);
    }
    input.execution.status = "completed";
    input.execution.currentStep = "done";
    delete input.execution.blockedReason;
    delete input.execution.failureReason;
    input.execution.updatedAt = now();
    input.graphExecution.status = "completed";
    input.graphExecution.currentStage = "done";
    delete input.graphExecution.blockedReason;
    delete input.graphExecution.failureReason;
    input.graphExecution.updatedAt = now();
    state.auditEvents.push(createAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      category: "workflow",
      action: "graph_reviewer_completed",
      status: "success",
      details: { executionId: input.execution.executionId, graphExecutionId: input.graphExecution.graphExecutionId, approved: true }
    }));
    return review;
  }

  const incident = createReviewerRejectionIncident(state, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    executionId: input.execution.executionId,
    graphExecutionId: input.graphExecution.graphExecutionId,
    graphId: input.graphExecution.graphId,
    evidenceId: input.execution.evidenceId,
    reviewerStepId: review.reviewerStep.stepId,
    reason: review.reason,
    details: { patientReadinessScore: input.patient.readinessScore, riskFlags: input.execution.output.riskFlags, approvalId: input.approvalId ?? null }
  });
  input.execution.status = "failed";
  input.execution.currentStep = "review_rejected";
  input.execution.failureReason = review.reason;
  input.execution.incidentId = incident.incidentId;
  input.execution.updatedAt = now();
  input.graphExecution.status = "failed";
  input.graphExecution.currentStage = "review_rejected";
  input.graphExecution.failureReason = review.reason;
  input.graphExecution.incidentId = incident.incidentId;
  input.graphExecution.updatedAt = now();
  return { ...review, incident };
};

const startWorkflowExecutionInternal = async (input: WorkflowStartInput): Promise<WorkflowStartResult | { status: number; body: { error: string } }> => {
  const state = await loadState();
  const graphDefinition = getGraphDefinition(state, DEFAULT_GRAPH_ID);
  if (!graphDefinition) return { status: 500, body: { error: "graph_definition_not_found" } };
  const { patient, carePlan } = getPatientBundle(state, input.patientId);
  if (!patient || !carePlan) return { status: 404, body: { error: "patient_or_care_plan_not_found" } };
  const policyControls = state.policyProfile.controls;
  const estimatedToolCalls = input.requestFollowupEmail ? 4 : 3;

  const policyDecision = evaluatePolicy({
    action: "workflow.execute",
    classification: input.classification,
    mode: input.mode,
    riskLevel: input.requestFollowupEmail ? "high" : "medium",
    zeroRetentionRequested: input.zeroRetentionRequested,
    estimatedToolCalls
  }, policyControls);

  const executionId = createId("ex");
  const graphExecutionId = createId("gx");
  const evidenceId = `ev-${executionId}`;
  const timestamp = now();
  const plannerStep = buildPlannerStep({ graphExecutionId, executionId, patient, carePlan, policyDecision });

  const execution: WorkflowExecutionRecord = {
    executionId,
    graphExecutionId,
    graphId: graphDefinition.graphId,
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    patientId: input.patientId,
    mode: input.mode,
    status: policyDecision.effect === "DENY" ? "failed" : "blocked",
    currentStep: policyDecision.effect === "DENY" ? "policy_denied" : "awaiting_approval",
    output: { summary: "", recommendation: "", riskFlags: [] },
    policyDecision,
    toolCalls: [],
    evidenceId,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const graphExecution: AgentGraphExecutionRecord = {
    graphExecutionId,
    graphId: graphDefinition.graphId,
    workflowId: input.workflowId,
    executionId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    patientId: input.patientId,
    mode: input.mode,
    status: policyDecision.effect === "DENY" ? "failed" : "waiting_for_approval",
    currentStage: policyDecision.effect === "DENY" ? "policy_denied" : "waiting_for_approval",
    steps: [plannerStep],
    policyDecision,
    context: {
      patientReadinessScore: patient.readinessScore,
      requestFollowupEmail: input.requestFollowupEmail,
      classification: input.classification,
      zeroRetentionRequested: input.zeroRetentionRequested,
      riskLevel: input.requestFollowupEmail ? "high" : "medium",
      toolCallIds: [],
      planSummary: `Planner prepared discharge plan for ${patient.displayName}.`,
      recommendation: "",
      riskFlags: []
    },
    evidenceId,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (policyDecision.effect === "DENY") {
    const incident = createPolicyViolationIncident(state, { tenantId: input.tenantId, actorId: input.actorId, executionId, graphExecutionId, graphId: graphDefinition.graphId, evidenceId, policyDecision, plannerStepId: plannerStep.stepId });
    execution.incidentId = incident.incidentId;
    execution.failureReason = policyDecision.reasons.join("; ") || "policy_violation";
    execution.output = { summary: `Execution denied before tool use for ${patient.displayName}.`, recommendation: "Do not route data externally until policy requirements are satisfied.", riskFlags: ["policy_violation"] };
    graphExecution.incidentId = incident.incidentId;
    graphExecution.failureReason = execution.failureReason;
    graphExecution.context.recommendation = execution.output.recommendation;
    graphExecution.context.riskFlags = execution.output.riskFlags;
    graphExecution.steps[0] = buildGraphStep({
      graphExecutionId,
      executionId,
      stage: "planner",
      order: 1,
      status: "blocked",
      inputs: plannerStep.inputs,
      outputs: { policyDecision, incidentId: incident.incidentId, reason: execution.failureReason },
      previousHash: null,
      startedAt: plannerStep.startedAt,
      completedAt: plannerStep.completedAt
    });
    addExecutionAndGraph(state, execution, graphExecution);
    state.auditEvents.push(createAuditEvent({ tenantId: input.tenantId, actorId: input.actorId, category: "workflow", action: "execution_denied", status: "blocked", details: { executionId, graphExecutionId, policyDecision, incidentId: incident.incidentId } }));
    await persistState(state);
    return { state, execution, graphExecution, incident };
  }

  const modelRoute = routeModel({
    classification: input.classification,
    zeroRetentionRequired:
      input.zeroRetentionRequested ||
      (policyControls.restrictExternalProvidersToZeroRetention && isPhiLike(input.classification))
  });
  const fhirToolCall = createToolCall({ executionId, toolId: "fhir.read-patient", action: "READ", status: "completed", classification: input.classification, resultRef: `obj://tenant-starlight-health/executions/${executionId}/fhir-patient.json` });
  const sqlToolCall = createToolCall({ executionId, toolId: "sql.read-care-plan", action: "READ", status: "completed", classification: input.classification, resultRef: `obj://tenant-starlight-health/executions/${executionId}/care-plan.json` });
  const modelToolCall = createToolCall({ executionId, toolId: "model.generate-discharge-summary", action: "EXECUTE", status: "completed", classification: input.classification, resultRef: `obj://tenant-starlight-health/executions/${executionId}/summary.json` });
  state.toolCalls.push(fhirToolCall, sqlToolCall, modelToolCall);
  execution.toolCalls.push(fhirToolCall.toolCallId, sqlToolCall.toolCallId, modelToolCall.toolCallId);
  const output = buildDischargeSummary(patient, carePlan);
  execution.output = output;
  execution.modelRoute = modelRoute;
  graphExecution.context.toolCallIds = execution.toolCalls.slice();
  graphExecution.context.modelRoute = modelRoute;
  graphExecution.context.planSummary = `Planner prepared discharge plan for ${patient.displayName}.`;
  graphExecution.context.recommendation = output.recommendation;
  graphExecution.context.riskFlags = output.riskFlags.slice();
  graphExecution.steps.push(buildExecutorStep({ graphExecutionId, executionId, patient, carePlan, output, modelRoute, toolCalls: execution.toolCalls.slice() }));

  if (policyDecision.effect === "REQUIRE_APPROVAL" && input.mode === "live") {
    const approval = createApproval({ tenantId: input.tenantId, requestedBy: input.actorId, reason: "Approve discharge follow-up email and reviewer handoff", riskLevel: "high", executionId });
    state.approvals.push(approval);
    execution.approvalId = approval.approvalId;
    graphExecution.approvalId = approval.approvalId;
    execution.blockedReason = "approval_required_before_reviewer_stage";
    graphExecution.blockedReason = execution.blockedReason;
    state.auditEvents.push(createAuditEvent({ tenantId: input.tenantId, actorId: input.actorId, category: "approval", action: "approval_requested", status: "blocked", details: { approvalId: approval.approvalId, executionId, graphExecutionId, riskLevel: approval.riskLevel } }));
    addExecutionAndGraph(state, execution, graphExecution);
    state.auditEvents.push(createAuditEvent({ tenantId: input.tenantId, actorId: input.actorId, category: "workflow", action: "execution_blocked_waiting_for_approval", status: "blocked", details: { executionId, graphExecutionId, approvalId: approval.approvalId } }));
    await persistState(state);
    return { state, execution, graphExecution, approval };
  }

  const review = finalizeApprovedExecution(state, { execution, graphExecution, patient, carePlan, actorId: input.actorId, tenantId: input.tenantId, requestFollowupEmail: input.requestFollowupEmail, policyDecision });
  if (review.incident) {
    execution.incidentId = review.incident.incidentId;
    graphExecution.incidentId = review.incident.incidentId;
  }
  addExecutionAndGraph(state, execution, graphExecution);
  state.auditEvents.push(createAuditEvent({ tenantId: input.tenantId, actorId: input.actorId, category: "workflow", action: review.approved ? "execution_completed" : "execution_failed", status: review.approved ? "success" : "blocked", details: { executionId, graphExecutionId, approved: review.approved, reason: review.reason } }));
  await persistState(state);
  return review.incident ? { state, execution, graphExecution, incident: review.incident } : { state, execution, graphExecution };
};

export const startDischargeAssistantExecution = async (input: {
  actorId: string;
  patientId: string;
  mode: PilotMode;
  workflowId: string;
  tenantId: string;
  requestFollowupEmail: boolean;
  classification?: DataClassification;
  zeroRetentionRequested?: boolean;
}): Promise<WorkflowStartResult | { status: number; body: { error: string } }> => startWorkflowExecutionInternal({
  actorId: input.actorId,
  patientId: input.patientId,
  mode: input.mode,
  workflowId: input.workflowId,
  tenantId: input.tenantId,
  requestFollowupEmail: input.requestFollowupEmail,
  classification: input.classification ?? "EPHI",
  zeroRetentionRequested: input.zeroRetentionRequested ?? true
});

export const resolveApprovalAndAdvanceExecution = async (input: { approvalId: string; actorId: string; decision: "approved" | "rejected"; reason?: string; }): Promise<WorkflowStartResult | { status: number; body: { error: string } }> => {
  const state = await loadState();
  const approvalIndex = state.approvals.findIndex((item) => item.approvalId === input.approvalId);
  if (approvalIndex === -1) return { status: 404, body: { error: "approval_not_found" } };
  const approval = state.approvals[approvalIndex]!;
  const updatedApproval = applyApprovalDecision(approval, {
    approverId: input.actorId,
    decision: input.decision,
    ...(input.reason ? { reason: input.reason } : {})
  });
  state.approvals[approvalIndex] = updatedApproval;
  state.auditEvents.push(createAuditEvent({ tenantId: updatedApproval.tenantId, actorId: input.actorId, category: "approval", action: "approval_decided", status: updatedApproval.status === "rejected" ? "blocked" : "success", details: { approvalId: updatedApproval.approvalId, executionId: updatedApproval.executionId, decision: updatedApproval.status, reason: updatedApproval.decisionReason } }));

  if (updatedApproval.status === "rejected" || !updatedApproval.executionId) {
    await persistState(state);
    return { state, execution: undefined as never, graphExecution: undefined as never };
  }

  const { execution, graphExecution } = getExecutionAndGraph(state, updatedApproval.executionId);
  if (!execution || !graphExecution) return { status: 404, body: { error: "execution_not_found" } };
  if (execution.status !== "blocked" || graphExecution.status !== "waiting_for_approval") {
    await persistState(state);
    return { state, execution, graphExecution };
  }

  execution.approvalId = updatedApproval.approvalId;
  graphExecution.approvalId = updatedApproval.approvalId;
  const { patient, carePlan } = getPatientBundle(state, execution.patientId);
  if (!patient || !carePlan) {
    await persistState(state);
    return { status: 404, body: { error: "patient_or_care_plan_not_found" } };
  }
  const review = finalizeApprovedExecution(state, { execution, graphExecution, patient, carePlan, actorId: input.actorId, tenantId: updatedApproval.tenantId, requestFollowupEmail: true, policyDecision: execution.policyDecision, approvalId: updatedApproval.approvalId });
  if (review.incident) {
    execution.incidentId = review.incident.incidentId;
    graphExecution.incidentId = review.incident.incidentId;
  }
  state.auditEvents.push(createAuditEvent({ tenantId: updatedApproval.tenantId, actorId: input.actorId, category: "workflow", action: review.approved ? "execution_completed" : "execution_failed", status: review.approved ? "success" : "blocked", details: { executionId: execution.executionId, graphExecutionId: graphExecution.graphExecutionId, approved: review.approved, reason: review.reason } }));
  await persistState(state);
  return review.incident ? { state, execution, graphExecution, incident: review.incident } : { state, execution, graphExecution };
};

export const listAgentGraphDefinitions = async (): Promise<AgentGraphDefinition[]> => (await loadState()).graphDefinitions;
export const getAgentGraphDefinition = async (graphId: string): Promise<AgentGraphDefinition | undefined> => getGraphDefinition(await loadState(), graphId);
export const getGraphExecutionByExecutionId = async (executionId: string): Promise<{ graphExecution: AgentGraphExecutionRecord; execution: WorkflowExecutionRecord; } | undefined> => {
  const state = await loadState();
  const execution = state.executions.find((item) => item.executionId === executionId);
  const graphExecution = state.graphExecutions.find((item) => item.executionId === executionId);
  return execution && graphExecution ? { graphExecution, execution } : undefined;
};
export const getGraphExecution = async (graphId: string, executionId: string): Promise<AgentGraphExecutionRecord | undefined> => {
  const state = await loadState();
  return state.graphExecutions.find((item) => item.graphId === graphId && item.executionId === executionId);
};
export const listIncidents = async (): Promise<IncidentRecord[]> => (await loadState()).incidents.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getIncident = async (incidentId: string): Promise<IncidentRecord | undefined> => (await loadState()).incidents.find((item) => item.incidentId === incidentId);
export const listExecutions = async (): Promise<WorkflowExecutionRecord[]> => (await loadState()).executions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const listApprovals = async (): Promise<ApprovalRecord[]> => (await loadState()).approvals.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
