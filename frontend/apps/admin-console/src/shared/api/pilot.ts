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

export interface PolicyControlImpact {
  control: keyof PolicyProfileControls;
  label: string;
  changed: boolean;
  beforeValue: boolean | number;
  afterValue: boolean | number;
  severity: "critical" | "high" | "medium" | "low";
  impact: string;
  recommendation: string;
}

export interface PolicyProfileExplainability {
  generatedAt: string;
  posture: "improved" | "degraded" | "unchanged";
  riskScoreBefore: number;
  riskScoreAfter: number;
  riskDelta: number;
  requiresBreakGlass: boolean;
  blockingIssueCount: number;
  warningIssueCount: number;
  summary: string;
  nextSteps: string[];
  controls: PolicyControlImpact[];
}

export interface PolicyImpactAdvisor {
  source: "local-llm" | "builtin";
  summary: string;
  riskNarrative: string;
  hints: string[];
  suggestedControls: PolicyProfileControls;
  suggestedReason: string;
  confidence: number;
}

export interface PolicyImpactReview {
  current: PolicyProfileSnapshot;
  proposed: PolicyProfileSnapshot;
  explainability: PolicyProfileExplainability;
  advisor: PolicyImpactAdvisor;
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

export interface ProjectPackConnector {
  connectorType: string;
  toolId: string;
  purpose: string;
}

export interface ProjectPackControl {
  controlId: string;
  title: string;
  enforcement: string;
}

export interface ProjectPackKpi {
  id: string;
  label: string;
  target: string;
  whyItMatters: string;
}

export interface ProjectPackDefinition {
  packId:
    | "secops-runtime-guard"
    | "revenue-cycle-copilot"
    | "supply-chain-resilience"
    | "clinical-quality-signal"
    | "board-risk-cockpit";
  name: string;
  industry: string;
  persona: string;
  businessProblem: string;
  expectedOutcome: string;
  workflowId: string;
  defaultPatientId: string;
  defaultClassification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
  connectors: ProjectPackConnector[];
  controls: ProjectPackControl[];
  kpis: ProjectPackKpi[];
}

export interface ProjectPackRunResponse {
  pack: ProjectPackDefinition;
  execution: ExecutionRecord;
}

export interface ProjectPackDataTable {
  tableId: string;
  title: string;
  description: string;
  source: string;
  classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | boolean>>;
}

export interface ProjectPackPolicyRule {
  ruleId: string;
  title: string;
  condition: string;
  effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  rationale: string;
  severity: "critical" | "high" | "medium";
}

export interface ProjectPackPolicyScenario {
  scenarioId: string;
  title: string;
  description: string;
  input: {
    action: string;
    classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
    riskLevel: "low" | "medium" | "high" | "critical";
    mode: "simulation" | "live";
    zeroRetentionRequested: boolean;
    estimatedToolCalls: number;
  };
  operatorHint: string;
  decision?: {
    effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
    reasons: string[];
    obligations: string[];
  };
}

export interface ProjectPackWalkthroughStep {
  step: number;
  title: string;
  operatorAction: string;
  openAegisControl: string;
  evidenceProduced: string;
}

export interface ProjectPackExperience {
  plainLanguageSummary: string;
  dataTables: ProjectPackDataTable[];
  policyRules: ProjectPackPolicyRule[];
  policyScenarios: ProjectPackPolicyScenario[];
  walkthrough: ProjectPackWalkthroughStep[];
  trustChecks: string[];
}

export interface ProjectPackExperienceResponse {
  pack: ProjectPackDefinition;
  experience: ProjectPackExperience;
  policyProfile: {
    profileName: string;
    profileVersion: number;
  };
}

export interface SandboxProofConnector {
  connectorType: string;
  toolId: string;
  purpose: string;
  sandboxClass: "read-only" | "approval-gated" | "policy-bounded";
  proofStatus: "pass";
  scope: string;
  proof: string;
}

export interface SandboxProofWorkflowScenario {
  title: string;
  mode?: "simulation" | "live";
  expectedDecision: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  humanApprovalRequired?: boolean;
  operatorHint: string;
}

export interface SandboxProofWorkflowStep {
  step: number;
  title: string;
  control: string;
  evidenceProduced: string;
}

export interface SandboxProofPack {
  pack: Pick<
    ProjectPackDefinition,
    "packId" | "name" | "industry" | "persona" | "workflowId" | "defaultClassification"
  >;
  connectorProof: SandboxProofConnector[];
  workflowProof: {
    summary: string;
    baselineProfile: string;
    walkthrough: SandboxProofWorkflowStep[];
    liveScenario?: SandboxProofWorkflowScenario;
    denyScenario?: SandboxProofWorkflowScenario;
    trustChecks: string[];
    evidence: {
      executions: number;
      approvals: number;
      incidents: number;
      auditEvents: number;
      latestExecutionId?: string;
      latestEvidenceId?: string;
    };
  };
}

export interface SandboxProofReport {
  generatedAt: string;
  summary: {
    totalPacks: number;
    totalConnectors: number;
    approvalGatedPackCount: number;
    deniedScenarioCount: number;
    evidenceBackedPackCount: number;
  };
  commands: string[];
  packs: SandboxProofPack[];
  report?: Record<string, unknown>;
}

export interface ProjectPackPolicyApplyResponse {
  pack: ProjectPackDefinition;
  appliedPreset: {
    profileName: string;
    changeSummary: string;
    controls: Partial<PolicyProfileControls>;
  };
  result: {
    profile: PolicyProfile;
    validation: PolicyValidationResult;
    breakGlassUsed: boolean;
  };
}

export interface ToolRegistryManifest {
  toolId: string;
  displayName: string;
  connectorType:
    | "microsoft-fabric"
    | "power-bi"
    | "sql"
    | "fhir"
    | "hl7"
    | "sharepoint"
    | "email"
    | "ticketing"
    | "project"
    | "aws"
    | "databricks"
    | "fabric"
    | "jira"
    | "confluence"
    | "openai"
    | "anthropic"
    | "google"
    | "azure-openai"
    | "airbyte"
    | "airflow"
    | "trino"
    | "superset"
    | "metabase"
    | "grafana"
    | "kafka"
    | "nifi"
    | "dagster"
    | "n8n";
  description: string;
  version: string;
  trustTier: "tier-1" | "tier-2" | "tier-3" | "tier-4";
  allowedActions: Array<"READ" | "WRITE" | "EXECUTE">;
  authMethods?: Array<"oauth2" | "api_key" | "service_principal" | "key_pair">;
  permissionScopes: string[];
  outboundDomains: string[];
  rateLimitPerMinute: number;
  idempotent: boolean;
  mockModeSupported: boolean;
  signature: string;
  signedBy: string;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export type PluginCategory = "analytics" | "data" | "clinical" | "collaboration" | "operations";
export type PluginAuthMode = "oauth" | "api-key" | "service-principal" | "key-pair";

export interface PluginSetupField {
  key: string;
  label: string;
  placeholder?: string;
  helper?: string;
  secret?: boolean;
  required?: boolean;
}

export interface PluginCatalogEntry extends ToolRegistryManifest {
  category: PluginCategory;
  categoryLabel: string;
  authMode: PluginAuthMode;
  authModeLabel: string;
  supportsOAuth: boolean;
  setupFields: PluginSetupField[];
  safetyNotes: string[];
  brokerOnlySecrets: string[];
}

export interface PluginInstanceRecord {
  toolId: string;
  catalogToolId: string;
  displayName: string;
  category: PluginCategory;
  categoryLabel: string;
  authMode: PluginAuthMode;
  authModeLabel: string;
  status: "draft" | "authorized" | "connected" | "failed" | "testing";
  config: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | undefined;
  lastTest?: PluginConnectionTestResult | undefined;
}

export interface PluginConnectionTestCheck {
  label: string;
  tone: "success" | "warning" | "danger";
  detail: string;
}

export interface PluginConnectionTestResult {
  checkedAt: string;
  status: "passed" | "warning" | "failed";
  summary: string;
  warnings: string[];
  checks: PluginConnectionTestCheck[];
}

export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  analytics: "Analytics",
  data: "Data",
  clinical: "Clinical",
  collaboration: "Collaboration",
  operations: "Operations"
};

export const PLUGIN_AUTH_MODE_LABELS: Record<PluginAuthMode, string> = {
  oauth: "OAuth",
  "api-key": "API key",
  "service-principal": "Service principal",
  "key-pair": "Key pair"
};

const PLUGIN_BLUEPRINTS: Record<
  ToolRegistryManifest["connectorType"],
  {
    category: PluginCategory;
    authMode: PluginAuthMode;
    setupFields: PluginSetupField[];
    safetyNotes: string[];
  }
> = {
  "microsoft-fabric": {
    category: "data",
    authMode: "service-principal",
    setupFields: [
      {
        key: "workspaceUrl",
        label: "Workspace URL",
        placeholder: "https://tenant.fabric.microsoft.com/workspace",
        required: true
      },
      { key: "catalog", label: "Catalog", placeholder: "clinical_prod", required: true },
      { key: "servicePrincipal", label: "Service principal", placeholder: "spn-openaegis-fabric", required: true },
      {
        key: "tokenRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/fabric/client-secret",
        helper: "Enter a secrets-broker reference only.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Use a service principal with least privilege.",
      "Store the client secret through the secrets broker only."
    ]
  },
  "power-bi": {
    category: "analytics",
    authMode: "oauth",
    setupFields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "tenant-demo", required: true },
      { key: "workspaceId", label: "Workspace ID", placeholder: "power-bi-workspace", required: true },
      { key: "reportId", label: "Report ID", placeholder: "report-001", required: true },
      {
        key: "clientSecretRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/powerbi/client-secret",
        helper: "Authorize first, then test with broker-backed credentials.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "OAuth authorization is required before test runs.",
      "Do not paste bearer tokens or raw client secrets."
    ]
  },
  sql: {
    category: "data",
    authMode: "key-pair",
    setupFields: [
      { key: "account", label: "Account", placeholder: "starlighthealth.us-east-1", required: true },
      { key: "warehouse", label: "Warehouse", placeholder: "WH_ANALYTICS_RO", required: true },
      { key: "database", label: "Database", placeholder: "CAREOPS", required: true },
      { key: "schema", label: "Schema", placeholder: "PUBLIC", required: true },
      { key: "role", label: "Role", placeholder: "ROLE_AGENT_READONLY", required: true },
      {
        key: "privateKeyRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/snowflake/private-key",
        helper: "Key material must stay behind the broker.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Use key-pair auth and rotate the private key through the broker.",
      "Keep the role read-only for initial rollout."
    ]
  },
  fhir: {
    category: "clinical",
    authMode: "oauth",
    setupFields: [
      { key: "baseUrl", label: "FHIR base URL", placeholder: "https://fhir.hospital.local", required: true },
      { key: "audience", label: "Audience", placeholder: "fhir-api", required: true },
      { key: "clientId", label: "Client ID", placeholder: "fhir-app-client-id", required: true },
      {
        key: "clientSecretRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/fhir/client-secret",
        helper: "Keep the OAuth client secret out of the browser.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Only use purpose-of-use approved scopes.",
      "Authorize before testing any live patient integration."
    ]
  },
  hl7: {
    category: "clinical",
    authMode: "api-key",
    setupFields: [
      { key: "endpoint", label: "Endpoint", placeholder: "hl7.integration.local", required: true },
      { key: "channel", label: "Channel", placeholder: "admissions", required: true },
      {
        key: "apiKeyRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/hl7/api-key",
        helper: "API keys are brokered only.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Keep interface channels constrained and audited.",
      "Treat inbound messages as regulated clinical data."
    ]
  },
  sharepoint: {
    category: "collaboration",
    authMode: "oauth",
    setupFields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://contoso.sharepoint.com/sites/openaegis", required: true },
      { key: "tenantId", label: "Tenant ID", placeholder: "tenant-demo", required: true },
      { key: "clientId", label: "Client ID", placeholder: "sharepoint-app-client-id", required: true },
      {
        key: "clientSecretRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/sharepoint/client-secret",
        helper: "OAuth-capable plugins must use explicit authorize actions.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Use least-privilege scopes for documents only.",
      "Do not place document credentials into static fields."
    ]
  },
  email: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.enterprise.local", required: true },
      { key: "fromAddress", label: "From address", placeholder: "noreply@starlighthealth.org", required: true },
      {
        key: "apiKeyRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/email/api-key",
        helper: "Use broker-backed API key references only.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Outbound email requires content redaction and audit traceability.",
      "Keep raw API keys out of the browser."
    ]
  },
  ticketing: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://tickets.enterprise.local", required: true },
      { key: "projectKey", label: "Project key", placeholder: "OPS", required: true },
      {
        key: "apiKeyRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/ticketing/api-key",
        helper: "Use broker-managed credentials only.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "Ticketing writes should remain bounded to approved projects.",
      "Never embed a raw API token in the setup form."
    ]
  },
  project: {
    category: "operations",
    authMode: "oauth",
    setupFields: [
      { key: "workspaceUrl", label: "Workspace URL", placeholder: "https://api.linear.app", required: true },
      { key: "teamId", label: "Team ID", placeholder: "TEAM-OPS", required: true },
      {
        key: "clientSecretRef",
        label: "Broker secret ref",
        placeholder: "vault://secret/project/client-secret",
        helper: "OAuth flows require explicit authorize before testing.",
        secret: true,
        required: true
      }
    ],
    safetyNotes: [
      "OAuth authorization is required before testing or promotion.",
      "Use broker references only for all secrets."
    ]
  },
  aws: {
    category: "operations",
    authMode: "service-principal",
    setupFields: [
      { key: "accountId", label: "Account ID", placeholder: "123456789012", required: true },
      { key: "region", label: "Region", placeholder: "us-east-1", required: true },
      { key: "roleArn", label: "Role ARN", placeholder: "arn:aws:iam::123456789012:role/OpenAegisRuntimeRole", required: true },
      { key: "externalIdRef", label: "Broker secret ref", placeholder: "vault://secret/aws/external-id", secret: true, required: true }
    ],
    safetyNotes: ["Use cross-account role + external ID.", "Keep external IDs in broker-backed secrets only."]
  },
  databricks: {
    category: "data",
    authMode: "oauth",
    setupFields: [
      { key: "workspaceUrl", label: "Workspace URL", placeholder: "https://dbc-demo.cloud.databricks.com", required: true },
      { key: "catalog", label: "Catalog", placeholder: "clinical_prod", required: true },
      { key: "tokenRef", label: "Broker secret ref", placeholder: "vault://secret/databricks/token", secret: true, required: true }
    ],
    safetyNotes: ["Use service identities only.", "Do not paste PAT tokens directly into setup fields."]
  },
  fabric: {
    category: "data",
    authMode: "service-principal",
    setupFields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "tenant-demo", required: true },
      { key: "workspaceId", label: "Workspace ID", placeholder: "fabric-workspace-001", required: true },
      { key: "clientId", label: "Client ID", placeholder: "fabric-app-client-id", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/fabric/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Prefer app registration scoped to one workspace.", "Keep client secrets broker-managed."]
  },
  jira: {
    category: "operations",
    authMode: "oauth",
    setupFields: [
      { key: "baseUrl", label: "Jira base URL", placeholder: "https://your-org.atlassian.net", required: true },
      { key: "projectKey", label: "Project key", placeholder: "SEC", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/jira/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Authorize before using write scopes.", "Restrict project permissions to least privilege."]
  },
  confluence: {
    category: "collaboration",
    authMode: "oauth",
    setupFields: [
      { key: "baseUrl", label: "Confluence URL", placeholder: "https://your-org.atlassian.net/wiki", required: true },
      { key: "spaceKey", label: "Space key", placeholder: "OPS", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/confluence/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Constrain write access to approved spaces.", "Use OAuth authorization before first test."]
  },
  openai: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "model", label: "Model", placeholder: "gpt-4.1", required: true },
      { key: "organizationId", label: "Organization ID", placeholder: "org-xxxx" },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/openai/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Use zero-retention policy where required.", "Never store raw provider keys in config."]
  },
  anthropic: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "model", label: "Model", placeholder: "claude-sonnet-4", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/anthropic/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Restrict models to approved provider allow-lists.", "Keep API keys broker-managed."]
  },
  google: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "model", label: "Model", placeholder: "gemini-2.5-pro", required: true },
      { key: "projectId", label: "Project ID", placeholder: "health-ml-prod", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/google/api-key", secret: true, required: true }
    ],
    safetyNotes: ["PHI/EPHI routes should enforce zero-retention compatible policies.", "Use project-level restrictions."]
  },
  "azure-openai": {
    category: "operations",
    authMode: "service-principal",
    setupFields: [
      { key: "endpoint", label: "Azure endpoint", placeholder: "https://contoso.openai.azure.com", required: true },
      { key: "deploymentName", label: "Deployment name", placeholder: "gpt-4.1", required: true },
      { key: "tenantId", label: "Tenant ID", placeholder: "tenant-demo", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/azure-openai/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Prefer managed identity or service principal for enterprise deployments.", "Bind access to tenant-scoped policy."]
  },
  airbyte: {
    category: "data",
    authMode: "api-key",
    setupFields: [
      { key: "endpoint", label: "Airbyte endpoint", placeholder: "https://airbyte.company.local/api", required: true },
      { key: "workspaceId", label: "Workspace ID", placeholder: "workspace-prod", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/airbyte/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Use workspace-scoped API keys.", "Only enable approved connection IDs for execute actions."]
  },
  airflow: {
    category: "operations",
    authMode: "oauth",
    setupFields: [
      { key: "endpoint", label: "Airflow API URL", placeholder: "https://airflow.company.local/api/v1", required: true },
      { key: "dagPrefix", label: "Allowed DAG prefix", placeholder: "openaegis_", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/airflow/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Allow execution only for approved DAG prefixes.", "Use OAuth service identity, not a personal account."]
  },
  trino: {
    category: "data",
    authMode: "key-pair",
    setupFields: [
      { key: "endpoint", label: "Trino endpoint", placeholder: "https://trino.company.local:8443", required: true },
      { key: "catalog", label: "Catalog", placeholder: "healthcare", required: true },
      { key: "schema", label: "Schema", placeholder: "ops_readonly", required: true },
      { key: "privateKeyRef", label: "Broker secret ref", placeholder: "vault://secret/trino/private-key", secret: true, required: true }
    ],
    safetyNotes: ["Use read-only catalogs for initial rollout.", "Keep query access scoped by role and schema."]
  },
  superset: {
    category: "analytics",
    authMode: "oauth",
    setupFields: [
      { key: "endpoint", label: "Superset URL", placeholder: "https://superset.company.local", required: true },
      { key: "workspaceId", label: "Workspace", placeholder: "risk-analytics", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/superset/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Restrict SQL Lab execute permissions to approved datasets.", "Separate viewer and author roles for governance."]
  },
  metabase: {
    category: "analytics",
    authMode: "api-key",
    setupFields: [
      { key: "endpoint", label: "Metabase URL", placeholder: "https://metabase.company.local", required: true },
      { key: "collection", label: "Collection", placeholder: "Operations", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/metabase/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Use collection-level permissions to constrain visibility.", "Keep query edit permissions disabled for read workloads."]
  },
  grafana: {
    category: "analytics",
    authMode: "api-key",
    setupFields: [
      { key: "endpoint", label: "Grafana URL", placeholder: "https://grafana.company.local", required: true },
      { key: "orgId", label: "Organization ID", placeholder: "1", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/grafana/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Use read-only API keys for dashboards and alert retrieval.", "Do not allow dashboard write scopes in production by default."]
  },
  kafka: {
    category: "operations",
    authMode: "key-pair",
    setupFields: [
      { key: "bootstrapServers", label: "Bootstrap servers", placeholder: "kafka-1:9093,kafka-2:9093", required: true },
      { key: "topicAllowlist", label: "Topic allowlist", placeholder: "alerts.*,governance.*", required: true },
      { key: "privateKeyRef", label: "Broker secret ref", placeholder: "vault://secret/kafka/private-key", secret: true, required: true }
    ],
    safetyNotes: ["Limit producers to approved topic patterns.", "Use mTLS and ACLs for all topic access."]
  },
  nifi: {
    category: "operations",
    authMode: "service-principal",
    setupFields: [
      { key: "endpoint", label: "NiFi URL", placeholder: "https://nifi.company.local/nifi-api", required: true },
      { key: "processGroupId", label: "Process group ID", placeholder: "root-openaegis", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/nifi/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Lock execute permission to dedicated process groups.", "Track provenance IDs in audit evidence."]
  },
  dagster: {
    category: "operations",
    authMode: "oauth",
    setupFields: [
      { key: "endpoint", label: "Dagster URL", placeholder: "https://dagster.company.local", required: true },
      { key: "location", label: "Code location", placeholder: "core_ops", required: true },
      { key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/dagster/client-secret", secret: true, required: true }
    ],
    safetyNotes: ["Allow only approved jobs and sensors for execution.", "Enforce role-scoped run launch permissions."]
  },
  n8n: {
    category: "operations",
    authMode: "api-key",
    setupFields: [
      { key: "endpoint", label: "n8n URL", placeholder: "https://n8n.company.local", required: true },
      { key: "projectId", label: "Project ID", placeholder: "ops-automation", required: true },
      { key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/n8n/api-key", secret: true, required: true }
    ],
    safetyNotes: ["Restrict workflow activation to approved projects.", "Use separate credentials for test and production."]
  }
};

const BROKER_REFERENCE_PATTERN = /^vault:\/\/[A-Za-z0-9._/-]+$/;
const INSTANCE_TOOL_ID_PREFIX = "plugin-";

export const isBrokerReference = (value: string | undefined | null): boolean => {
  const trimmed = value?.trim();
  return Boolean(trimmed && BROKER_REFERENCE_PATTERN.test(trimmed));
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const parseCatalogToolId = (toolId: string) => {
  if (!toolId.startsWith(INSTANCE_TOOL_ID_PREFIX)) return toolId;
  const suffix = toolId.slice(INSTANCE_TOOL_ID_PREFIX.length);
  return suffix.split("--")[0] ?? toolId;
};

const toManifestMap = (manifests: ToolRegistryManifest[]): ToolRegistryManifest[] => manifests;

const authMethodToMode = (authMethods: ToolRegistryManifest["authMethods"]): PluginAuthMode => {
  const methods = authMethods ?? [];
  if (methods.includes("oauth2")) return "oauth";
  if (methods.includes("service_principal")) return "service-principal";
  if (methods.includes("key_pair")) return "key-pair";
  return "api-key";
};

const defaultBlueprintForManifest = (
  manifest: ToolRegistryManifest
): {
  category: PluginCategory;
  authMode: PluginAuthMode;
  setupFields: PluginSetupField[];
  safetyNotes: string[];
} => {
  const connectorCategory: Record<ToolRegistryManifest["connectorType"], PluginCategory> = {
    "microsoft-fabric": "data",
    "power-bi": "analytics",
    sql: "data",
    fhir: "clinical",
    hl7: "clinical",
    sharepoint: "collaboration",
    email: "operations",
    ticketing: "operations",
    project: "operations",
    aws: "operations",
    databricks: "data",
    fabric: "data",
    jira: "operations",
    confluence: "collaboration",
    openai: "operations",
    anthropic: "operations",
    google: "operations",
    "azure-openai": "operations",
    airbyte: "data",
    airflow: "operations",
    trino: "data",
    superset: "analytics",
    metabase: "analytics",
    grafana: "analytics",
    kafka: "operations",
    nifi: "operations",
    dagster: "operations",
    n8n: "operations"
  };
  const authMode = authMethodToMode(manifest.authMethods);
  return {
    category: connectorCategory[manifest.connectorType] ?? "operations",
    authMode,
    setupFields: [
      { key: "endpoint", label: "Endpoint", placeholder: `https://${manifest.connectorType}.example.com`, required: true },
      ...(authMode === "api-key"
        ? [{ key: "apiKeyRef", label: "Broker secret ref", placeholder: "vault://secret/provider/api-key", secret: true, required: true } satisfies PluginSetupField]
        : authMode === "service-principal"
          ? [{ key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/provider/client-secret", secret: true, required: true } satisfies PluginSetupField]
          : authMode === "key-pair"
            ? [{ key: "privateKeyRef", label: "Broker secret ref", placeholder: "vault://secret/provider/private-key", secret: true, required: true } satisfies PluginSetupField]
            : [{ key: "clientSecretRef", label: "Broker secret ref", placeholder: "vault://secret/provider/client-secret", secret: true, required: true } satisfies PluginSetupField])
    ],
    safetyNotes: ["Use broker references only for secret values.", "Apply least-privilege scopes before enabling writes."]
  };
};

const toPluginCatalogEntry = (manifest: ToolRegistryManifest): PluginCatalogEntry => {
  const blueprint = PLUGIN_BLUEPRINTS[manifest.connectorType] ?? defaultBlueprintForManifest(manifest);
  return {
    ...manifest,
    category: blueprint.category,
    categoryLabel: PLUGIN_CATEGORY_LABELS[blueprint.category],
    authMode: blueprint.authMode,
    authModeLabel: PLUGIN_AUTH_MODE_LABELS[blueprint.authMode],
    supportsOAuth: blueprint.authMode === "oauth",
    setupFields: blueprint.setupFields,
    safetyNotes: blueprint.safetyNotes,
    brokerOnlySecrets: blueprint.setupFields.filter((field) => field.secret).map((field) => field.key)
  };
};

const toPluginInstanceRecord = (manifest: ToolRegistryManifest): PluginInstanceRecord | null => {
  if (!manifest.toolId.startsWith(INSTANCE_TOOL_ID_PREFIX)) return null;
  const catalogToolId = parseCatalogToolId(manifest.toolId);
  const blueprint = PLUGIN_BLUEPRINTS[manifest.connectorType] ?? defaultBlueprintForManifest(manifest);
  return {
    toolId: manifest.toolId,
    catalogToolId,
    displayName: manifest.displayName,
    category: blueprint.category,
    categoryLabel: PLUGIN_CATEGORY_LABELS[blueprint.category],
    authMode: blueprint.authMode,
    authModeLabel: PLUGIN_AUTH_MODE_LABELS[blueprint.authMode],
    status: manifest.status === "published" ? "authorized" : "draft",
    config: {},
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    publishedAt: manifest.publishedAt
  };
};

const validatePluginConfig = (catalogEntry: PluginCatalogEntry, config: Record<string, string>) => {
  const missingFields = catalogEntry.setupFields.filter((field) => field.required && !(config[field.key] ?? "").trim());
  const invalidSecretFields = catalogEntry.setupFields.filter((field) => {
    if (!field.secret) return false;
    const value = (config[field.key] ?? "").trim();
    return value.length > 0 && !isBrokerReference(value);
  });

  return { missingFields, invalidSecretFields };
};

const buildPluginTestResult = (
  catalogEntry: PluginCatalogEntry,
  instance: PluginInstanceRecord,
  manifest: ToolRegistryManifest
): PluginConnectionTestResult => {
  const { missingFields, invalidSecretFields } = validatePluginConfig(catalogEntry, instance.config);
  const checks: PluginConnectionTestCheck[] = [
    {
      label: "Catalog record",
      tone: "success",
      detail: `${manifest.displayName} is registered in tool-registry as ${manifest.toolId}.`
    },
    {
      label: "Broker references",
      tone: invalidSecretFields.length === 0 ? "success" : "danger",
      detail:
        invalidSecretFields.length === 0
          ? "All secret inputs use broker references."
          : `Invalid secret format in: ${invalidSecretFields.map((field) => field.label).join(", ")}`
    },
    {
      label: "Required fields",
      tone: missingFields.length === 0 ? "success" : "danger",
      detail:
        missingFields.length === 0
          ? "All required fields are present."
          : `Missing: ${missingFields.map((field) => field.label).join(", ")}`
    },
    {
      label: "Authorization state",
      tone: catalogEntry.supportsOAuth && instance.status !== "authorized" ? "warning" : "success",
      detail: catalogEntry.supportsOAuth
        ? instance.status === "authorized"
          ? "OAuth authorization is complete."
          : "OAuth-capable plugins should be authorized before promotion."
        : "This plugin does not require OAuth authorization."
    }
  ];

  const warnings = [
    ...(catalogEntry.supportsOAuth && instance.status !== "authorized"
      ? ["Authorize the OAuth plugin before using it for live traffic."]
      : []),
    ...catalogEntry.safetyNotes,
    ...(invalidSecretFields.length > 0
      ? invalidSecretFields.map((field) => `${field.label} must be a broker reference (vault://...).`)
      : [])
  ];

  const status =
    invalidSecretFields.length > 0 || missingFields.length > 0
      ? "failed"
      : catalogEntry.supportsOAuth && instance.status !== "authorized"
        ? "warning"
        : "passed";

  return {
    checkedAt: new Date().toISOString(),
    status,
    summary:
      status === "passed"
        ? `${catalogEntry.displayName} is ready for broker-backed traffic.`
        : status === "warning"
          ? `${catalogEntry.displayName} needs OAuth authorization before promotion.`
          : `${catalogEntry.displayName} has blocking setup issues.`,
    warnings,
    checks
  };
};

const baseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3000";
const toolRegistryBaseUrl = import.meta.env.VITE_TOOL_REGISTRY_URL ?? baseUrl;

const jsonRequest = async <T>(
  path: string,
  method: "GET" | "POST",
  accessToken?: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  serviceBaseUrl: string = baseUrl
): Promise<T> => {
  const headers: Record<string, string> = { "content-type": "application/json", ...(extraHeaders ?? {}) };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${serviceBaseUrl}${path}`, {
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

const toolRegistryRequest = <T>(
  path: string,
  method: "GET" | "POST",
  accessToken?: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) => jsonRequest<T>(path, method, accessToken, body, extraHeaders, toolRegistryBaseUrl);

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
  listProjectPacks: (token: string) =>
    jsonRequest<{ packs: ProjectPackDefinition[] }>("/v1/projects/packs", "GET", token),
  getSandboxProof: (token: string) =>
    jsonRequest<SandboxProofReport>("/v1/projects/sandbox-proof", "GET", token),
  getProjectPack: (token: string, packId: ProjectPackDefinition["packId"]) =>
    jsonRequest<ProjectPackDefinition>(`/v1/projects/packs/${packId}`, "GET", token),
  getProjectPackExperience: (token: string, packId: ProjectPackDefinition["packId"]) =>
    jsonRequest<ProjectPackExperienceResponse>(`/v1/projects/packs/${packId}/experience`, "GET", token),
  runProjectPack: (
    token: string,
    packId: ProjectPackDefinition["packId"],
    payload: {
      mode: "simulation" | "live";
      requestFollowupEmail?: boolean;
      classification?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
      zeroRetentionRequested?: boolean;
    }
  ) =>
    jsonRequest<ProjectPackRunResponse>(`/v1/projects/packs/${packId}/run`, "POST", token, payload),
  applyProjectPackPolicyPreset: (
    token: string,
    packId: ProjectPackDefinition["packId"],
    payload?: { profileName?: string; changeSummary?: string; controls?: Partial<PolicyProfileControls> }
  ) =>
    jsonRequest<ProjectPackPolicyApplyResponse>(`/v1/projects/packs/${packId}/policies/apply`, "POST", token, payload ?? {}),
  getPolicyProfile: (token: string) =>
    jsonRequest<PolicyProfileSnapshot>("/v1/policies/profile", "GET", token),
  previewPolicyProfile: (token: string, payload: { profileName?: string; controls: Partial<PolicyProfileControls> }) =>
    jsonRequest<PolicyProfileSnapshot>("/v1/policies/profile/preview", "POST", token, payload),
  reviewPolicyWithCopilot: (
    token: string,
    payload: { operatorGoal: string; profileName?: string; controls: Partial<PolicyProfileControls> }
  ) => jsonRequest<PolicyCopilotReview>("/v1/policies/profile/copilot", "POST", token, payload),
  explainPolicyProfile: (
    token: string,
    payload: { operatorGoal?: string; profileName?: string; controls: Partial<PolicyProfileControls> }
  ) => jsonRequest<PolicyImpactReview>("/v1/policies/profile/explain", "POST", token, payload),
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
    ),
  listPluginCatalog: async (token?: string) => {
    const response = await toolRegistryRequest<{ manifests: ToolRegistryManifest[] }>("/v1/tools?status=published", "GET", token);
    return toManifestMap(response.manifests)
      .filter((manifest) => !manifest.toolId.startsWith(INSTANCE_TOOL_ID_PREFIX))
      .map(toPluginCatalogEntry);
  },
  listPluginInstances: async (token?: string) => {
    const response = await toolRegistryRequest<{ manifests: ToolRegistryManifest[] }>("/v1/tools", "GET", token);
    return toManifestMap(response.manifests)
      .filter((manifest) => manifest.toolId.startsWith(INSTANCE_TOOL_ID_PREFIX))
      .map((manifest) => {
        const instance = toPluginInstanceRecord(manifest);
        return instance;
      })
      .filter((item): item is PluginInstanceRecord => item !== null);
  },
  getPluginInstance: async (token: string | undefined, instanceId: string) => {
    const manifest = await toolRegistryRequest<ToolRegistryManifest>(`/v1/tools/${instanceId}`, "GET", token);
    const instance = toPluginInstanceRecord(manifest);
    if (!instance) {
      throw new Error("plugin_instance_not_found");
    }
    return instance;
  },
  createPluginInstance: async (
    token: string | undefined,
    actorId: string,
    payload: {
      catalogToolId: string;
      instanceName: string;
      config: Record<string, string>;
      signer?: string;
    }
  ) => {
    const catalog = await toolRegistryRequest<{ manifests: ToolRegistryManifest[] }>("/v1/tools?status=published", "GET", token);
    const baseManifest = catalog.manifests.find((manifest) => manifest.toolId === payload.catalogToolId);
    if (!baseManifest) {
      throw new Error("plugin_catalog_not_found");
    }

    const catalogEntry = toPluginCatalogEntry(baseManifest);
    const validation = validatePluginConfig(catalogEntry, payload.config);
    if (validation.missingFields.length > 0) {
      throw new Error(
        `missing_required_fields:${validation.missingFields.map((field) => field.label).join(", ")}`
      );
    }
    if (validation.invalidSecretFields.length > 0) {
      throw new Error(
        `invalid_secret_format:${validation.invalidSecretFields.map((field) => field.label).join(", ")}`
      );
    }

    const instanceSlug = slugify(payload.instanceName) || "instance";
    const toolId = `${INSTANCE_TOOL_ID_PREFIX}${payload.catalogToolId}--${instanceSlug}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const response = await toolRegistryRequest<ToolRegistryManifest>(
      "/v1/tools",
      "POST",
      token,
      {
        toolId,
        displayName: payload.instanceName,
        connectorType: baseManifest.connectorType,
        description: `${baseManifest.displayName} instance for ${payload.instanceName}`,
        version: baseManifest.version,
        trustTier: baseManifest.trustTier,
        allowedActions: baseManifest.allowedActions,
        authMethods: baseManifest.authMethods,
        permissionScopes: baseManifest.permissionScopes,
        outboundDomains: baseManifest.outboundDomains,
        signature: `${baseManifest.signature}:${instanceSlug}`,
        signedBy: payload.signer ?? actorId,
        status: "draft",
        authMode: catalogEntry.authMode,
        catalogToolId: payload.catalogToolId,
        config: payload.config
      },
      { "x-actor-id": actorId }
    );

    const instance: PluginInstanceRecord = {
      toolId: response.toolId,
      catalogToolId: payload.catalogToolId,
      displayName: response.displayName,
      category: catalogEntry.category,
      categoryLabel: catalogEntry.categoryLabel,
      authMode: catalogEntry.authMode,
      authModeLabel: catalogEntry.authModeLabel,
      status: "draft",
      config: payload.config,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      publishedAt: response.publishedAt
    };

    return instance;
  },
  authorizePluginInstance: async (
    token: string | undefined,
    actorId: string,
    instance: PluginInstanceRecord,
    signer?: string
  ) => {
    const manifest = await toolRegistryRequest<ToolRegistryManifest>(
      `/v1/tools/${instance.toolId}/publish`,
      "POST",
      token,
      { signer: signer ?? actorId },
      { "x-actor-id": actorId }
    );
    const updated = toPluginInstanceRecord(manifest);
    if (!updated) {
      throw new Error("plugin_instance_not_found");
    }
    return {
      ...instance,
      status: "authorized",
      updatedAt: manifest.updatedAt,
      publishedAt: manifest.publishedAt,
      displayName: manifest.displayName,
      authMode: updated.authMode,
      authModeLabel: updated.authModeLabel
    } satisfies PluginInstanceRecord;
  },
  testPluginConnection: async (token: string | undefined, instance: PluginInstanceRecord) => {
    const manifest = await toolRegistryRequest<ToolRegistryManifest>(`/v1/tools/${instance.toolId}`, "GET", token);
    const catalogEntry = toPluginCatalogEntry(manifest.toolId.startsWith(INSTANCE_TOOL_ID_PREFIX)
      ? { ...manifest, toolId: instance.catalogToolId }
      : manifest);
    const test = buildPluginTestResult(catalogEntry, instance, manifest);
    return test;
  }
};
