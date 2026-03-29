export interface DemoPersona {
  key: "clinician" | "security";
  email: string;
  label: string;
  role: string;
  description: string;
}

export interface AgentBlueprint {
  agentId: string;
  name: string;
  purpose: string;
  owner: string;
  sandboxProfile: string;
  toolScopes: string[];
  budget: {
    stepLimit: number;
    maxRuntimeSeconds: number;
    retryLimit: number;
  };
}

export interface WorkflowBlueprint {
  workflowId: string;
  name: string;
  objective: string;
  trigger: string;
  classification: string;
  highRiskStep: string;
  steps: Array<{
    id: string;
    title: string;
    actor: string;
    control: string;
  }>;
}

export interface ConnectorBlueprint {
  name: string;
  trustTier: "tier-1" | "tier-2" | "tier-3" | "tier-4";
  capability: string;
  defaultPermission: string;
  riskNotes: string;
}

export interface PolicyBlueprint {
  policyId: string;
  name: string;
  scope: string;
  enforcement: string;
  defaultDecision: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    key: "clinician",
    email: "clinician@starlighthealth.org",
    label: "Clinician session",
    role: "workflow_operator",
    description: "Runs the discharge assistant and reviews workflow output."
  },
  {
    key: "security",
    email: "security@starlighthealth.org",
    label: "Security reviewer",
    role: "approver",
    description: "Performs approvals, incident review, and audit inspection."
  }
];

export const PILOT_USE_CASE = {
  tenantId: "tenant-starlight-health",
  title: "Discharge Readiness Assistant",
  subtitle: "A zero-trust workflow for summarizing discharge readiness and escalating sensitive actions.",
  patientId: "patient-1001",
  workflowId: "wf-discharge-assistant",
  classification: "EPHI",
  summary:
    "The agent reads FHIR patient context and care-plan tasks, drafts a discharge summary, and blocks the outbound email step until an approver clears the risk.",
  outcome:
    "Simulation can run end-to-end without approval; live mode pauses before the follow-up email and creates an auditable approval record."
} as const;

export const AGENT_BLUEPRINTS: AgentBlueprint[] = [
  {
    agentId: "agent-discharge-planner",
    name: "Discharge Planner",
    purpose: "Drafts the discharge summary and recommended next steps from FHIR and SQL sources.",
    owner: "Clinical operations",
    sandboxProfile: "no-network-default",
    toolScopes: ["fhir.read", "sql.read", "model.infer"],
    budget: { stepLimit: 12, maxRuntimeSeconds: 45, retryLimit: 1 }
  },
  {
    agentId: "agent-approval-guardian",
    name: "Approval Guardian",
    purpose: "Classifies outbound actions, forces approvals, and writes immutable evidence.",
    owner: "Security engineering",
    sandboxProfile: "egress-deny",
    toolScopes: ["policy.evaluate", "approval.create", "audit.write"],
    budget: { stepLimit: 6, maxRuntimeSeconds: 20, retryLimit: 0 }
  },
  {
    agentId: "agent-audit-scribe",
    name: "Audit Scribe",
    purpose: "Normalizes audit events into replayable evidence packages.",
    owner: "Platform governance",
    sandboxProfile: "read-only",
    toolScopes: ["audit.read", "object.write"],
    budget: { stepLimit: 8, maxRuntimeSeconds: 30, retryLimit: 1 }
  }
];

export const WORKFLOW_BLUEPRINTS: WorkflowBlueprint[] = [
  {
    workflowId: PILOT_USE_CASE.workflowId,
    name: PILOT_USE_CASE.title,
    objective: "Prepare a discharge summary and handle policy-gated follow-up communication.",
    trigger: "Clinician submits a discharge review request.",
    classification: "EPHI",
    highRiskStep: "Send follow-up email to patient",
    steps: [
      { id: "s1", title: "Read patient context", actor: "FHIR connector", control: "Connector scope: read-only" },
      { id: "s2", title: "Read care plan tasks", actor: "SQL connector", control: "Sandboxed tool execution" },
      { id: "s3", title: "Generate summary", actor: "Model broker", control: "Zero-retention routing" },
      { id: "s4", title: "Policy evaluation", actor: "Policy service", control: "Enforce outside the model" },
      { id: "s5", title: "Approval gate", actor: "Security reviewer", control: "Dual-control for high risk" },
      { id: "s6", title: "Send follow-up email", actor: "Email connector", control: "Audit + idempotency" }
    ]
  }
];

export const CONNECTOR_BLUEPRINTS: ConnectorBlueprint[] = [
  {
    name: "FHIR",
    trustTier: "tier-1",
    capability: "Read patient demographics, encounters, medications, and discharge context.",
    defaultPermission: "read-only",
    riskNotes: "EPHI present; enforce purpose-of-use and DLP on egress."
  },
  {
    name: "SQL care-plan store",
    trustTier: "tier-1",
    capability: "Read structured care-plan tasks and follow-up work items.",
    defaultPermission: "read-only",
    riskNotes: "Outputs can still contain PHI when joined with clinical context."
  },
  {
    name: "Email",
    trustTier: "tier-2",
    capability: "Send follow-up messages only after approval and content redaction.",
    defaultPermission: "execute",
    riskNotes: "High-risk outbound channel; requires approval and audit trail."
  },
  {
    name: "Object storage evidence",
    trustTier: "tier-1",
    capability: "Stores immutable evidence references, execution artifacts, and replay data.",
    defaultPermission: "write",
    riskNotes: "Content-addressed storage only; no ad hoc writes from model context."
  }
];

export const POLICY_BLUEPRINTS: PolicyBlueprint[] = [
  {
    policyId: "policy-zero-retention-ephi",
    name: "Zero-retention EPHI routing",
    scope: "Model broker",
    enforcement: "Route EPHI to approved zero-retention providers only.",
    defaultDecision: "allow with route restrictions"
  },
  {
    policyId: "policy-high-risk-email",
    name: "Approval for outbound clinical email",
    scope: "Workflow orchestration",
    enforcement: "Require human approval before any live outbound message.",
    defaultDecision: "require approval"
  },
  {
    policyId: "policy-tool-egress",
    name: "Tool network egress deny-by-default",
    scope: "Runtime sandbox",
    enforcement: "Allow only signed connector manifests with explicit destinations.",
    defaultDecision: "deny"
  }
];

export const EXECUTIVE_KPIS = [
  { label: "Policy decisions enforced", value: "100%", note: "No trusted model can bypass control-plane policy." },
  { label: "Approved risky actions", value: "1 gate", note: "Outbound email requires a live reviewer." },
  { label: "Audit coverage", value: "100%", note: "Every major action emits an immutable evidence record." },
  { label: "Tenant isolation", value: "Strict", note: "Tenant context is required in all pilot routes." }
];

