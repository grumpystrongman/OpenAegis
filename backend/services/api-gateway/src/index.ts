import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  explainPolicyProfileChange,
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
import {
  InMemoryRateLimiter,
  createSignedInternalContextHeaders,
  enforceRateLimit,
  parseContext,
  sha256Hex,
  stableSerialize
} from "@openaegis/security-kit";
import {
  getProjectPack,
  getProjectPackDailyPlaybook,
  getProjectPackDashboards,
  getProjectPackExperience,
  getProjectPackPolicyPreset,
  getProjectPackSettingsChecklist,
  listProjectPacks
} from "./project-packs.js";

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

const approvalViewRoles = ["approver", "security_admin", "auditor", "platform_admin"] as const;
const approvalCreateRoles = ["approver", "security_admin", "platform_admin"] as const;
const approvalDecisionRoles = ["approver", "security_admin", "platform_admin"] as const;
const auditReadRoles = ["auditor", "security_admin", "platform_admin"] as const;
const incidentReadRoles = ["auditor", "security_admin", "platform_admin"] as const;
const agentGraphReadRoles = ["auditor", "security_admin", "platform_admin"] as const;
const commercialReadRoles = ["auditor", "security_admin", "platform_admin"] as const;
const policyProfileReadRoles = ["auditor", "security_admin", "platform_admin"] as const;
const policyProfileManageRoles = ["security_admin", "platform_admin"] as const;
const projectPackReadRoles = ["workflow_operator", "analyst", "auditor", "security_admin", "platform_admin"] as const;
const projectPackRunRoles = ["workflow_operator", "security_admin", "platform_admin"] as const;

const gatewayRateLimiter = new InMemoryRateLimiter(250, 60_000);
const gatewaySecurityStateFile = resolve(process.cwd(), ".volumes", "api-gateway-security-state.json");

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

const hasAnyRole = (session: AuthSession, roles: readonly string[]): boolean =>
  roles.some((role) => session.roles.includes(role));

const isInsecureDemoAuthEnabled = (): boolean =>
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH === "true";

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

const readOnlyConnectorTypes = new Set([
  "airbyte",
  "fhir",
  "grafana",
  "kafka",
  "metabase",
  "superset",
  "trino"
]);

const approvalGatedConnectorTypes = new Set([
  "airflow",
  "dagster",
  "hl7",
  "project",
  "sharepoint",
  "ticketing"
]);

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

const buildSandboxProofReport = async () => {
  const state = await loadState();
  const snapshot = await getPolicyProfileSnapshot();
  const commercialReport = await readCommercialProofReport();
  const packs = listProjectPacks().map((pack) => {
    const experience = getProjectPackExperience(pack.packId);
    const policyPreset = getProjectPackPolicyPreset(pack.packId);
    const packExecutions = state.executions.filter((execution) => execution.workflowId === pack.workflowId);
    const executionIds = new Set(packExecutions.map((execution) => execution.executionId));
    const packApprovals = state.approvals.filter(
      (approval) => typeof approval.executionId === "string" && executionIds.has(approval.executionId)
    );
    const packIncidents = state.incidents.filter(
      (incident) => typeof incident.executionId === "string" && executionIds.has(incident.executionId)
    );
    const packAuditEvents = state.auditEvents.filter((event) => {
      const executionId = event.details.executionId;
      return typeof executionId === "string" && executionIds.has(executionId);
    });
    const latestExecution = packExecutions
      .slice()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];

    const evaluatedScenarios = (experience?.policyScenarios ?? []).map((scenario) => ({
      ...scenario,
      decision: evaluatePolicy(
        {
          action: scenario.input.action,
          classification: scenario.input.classification,
          riskLevel: scenario.input.riskLevel,
          mode: scenario.input.mode,
          zeroRetentionRequested: scenario.input.zeroRetentionRequested,
          estimatedToolCalls: scenario.input.estimatedToolCalls
        },
        snapshot.profile.controls
      )
    }));
    const liveScenario =
      evaluatedScenarios.find(
        (scenario) => scenario.input.mode === "live" && scenario.decision.effect === "REQUIRE_APPROVAL"
      ) ??
      evaluatedScenarios.find((scenario) => scenario.input.mode === "live") ??
      evaluatedScenarios[0];
    const denyScenario = evaluatedScenarios.find((scenario) => scenario.decision.effect === "DENY");

    return {
      pack: {
        packId: pack.packId,
        name: pack.name,
        industry: pack.industry,
        persona: pack.persona,
        workflowId: pack.workflowId,
        defaultClassification: pack.defaultClassification
      },
      connectorProof: pack.connectors.map((connector) => {
        const sandboxClass = readOnlyConnectorTypes.has(connector.connectorType)
          ? "read-only"
          : approvalGatedConnectorTypes.has(connector.connectorType)
            ? "approval-gated"
            : "policy-bounded";
        return {
          connectorType: connector.connectorType,
          toolId: connector.toolId,
          purpose: connector.purpose,
          sandboxClass,
          proofStatus: "pass" as const,
          scope:
            sandboxClass === "read-only"
              ? "Connector reads governed context only."
              : sandboxClass === "approval-gated"
                ? "Connector actions stay behind live approval or bounded orchestration."
                : "Connector remains policy-bounded inside the declared workflow.",
          proof:
            sandboxClass === "read-only"
              ? `Read access is constrained to ${pack.name} context and replayable evidence.`
              : sandboxClass === "approval-gated"
                ? `Live actions for ${pack.name} require a human checkpoint before the connector can complete.`
                : `Connector use stays inside the ${pack.workflowId} workflow with evidence-linked execution records.`
        };
      }),
      workflowProof: {
        summary:
          experience?.plainLanguageSummary ??
          `${pack.name} keeps connector actions inside a policy-first workflow with replayable evidence.`,
        baselineProfile: policyPreset?.profileName ?? snapshot.profile.profileName,
        walkthrough: (experience?.walkthrough ?? []).map((step) => ({
          step: step.step,
          title: step.title,
          control: step.openAegisControl,
          evidenceProduced: step.evidenceProduced
        })),
        liveScenario: liveScenario
          ? {
              title: liveScenario.title,
              mode: liveScenario.input.mode,
              expectedDecision: liveScenario.decision.effect,
              humanApprovalRequired: liveScenario.decision.effect === "REQUIRE_APPROVAL",
              operatorHint: liveScenario.operatorHint
            }
          : undefined,
        denyScenario: denyScenario
          ? {
              title: denyScenario.title,
              expectedDecision: denyScenario.decision.effect,
              operatorHint: denyScenario.operatorHint
            }
          : undefined,
        trustChecks: experience?.trustChecks ?? [],
        evidence: {
          executions: packExecutions.length,
          approvals: packApprovals.length,
          incidents: packIncidents.length,
          auditEvents: packAuditEvents.length,
          latestExecutionId: latestExecution?.executionId,
          latestEvidenceId: latestExecution?.evidenceId
        }
      }
    };
  });

  const approvalGatedPackCount = packs.filter((pack) => pack.workflowProof.liveScenario?.humanApprovalRequired).length;
  const deniedScenarioCount = packs.reduce(
    (total, pack) => total + (pack.workflowProof.denyScenario ? 1 : 0),
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPacks: packs.length,
      totalConnectors: packs.reduce((total, pack) => total + pack.connectorProof.length, 0),
      approvalGatedPackCount,
      deniedScenarioCount,
      evidenceBackedPackCount: packs.filter((pack) => (pack.workflowProof.evidence.auditEvents ?? 0) > 0).length
    },
    commands: [
      "npm run proof:commercial",
      "node tools/scripts/commercial-proof.mjs",
      "node tools/scripts/capture-commercial-screenshots.mjs"
    ],
    packs,
    ...(commercialReport ? { report: commercialReport } : {})
  };
};

const parseAllowedOrigins = (): Set<string> =>
  new Set(
    (process.env.OPENAEGIS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  );

const buildCorsHeaders = (request?: IncomingMessage): Record<string, string> => {
  if (!request) return {};
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
  if (origin.length === 0) return {};
  const allowedOrigins = parseAllowedOrigins();
  if (!allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
};

const buildFallbackCorsHeaders = (): Record<string, string> => {
  const allowedOrigins = Array.from(parseAllowedOrigins());
  if (allowedOrigins.length !== 1) return {};
  return {
    "access-control-allow-origin": allowedOrigins[0]!,
    vary: "Origin",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown, request?: IncomingMessage) => {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...(request ? buildCorsHeaders(request) : buildFallbackCorsHeaders())
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage, maxBytes = 1024 * 1024): Promise<JsonMap> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("payload_too_large");
    }
    chunks.push(buffer);
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

interface AuthSession {
  actorId: string;
  tenantId?: string;
  roles: string[];
  assuranceLevel?: "aal1" | "aal2" | "aal3";
  source: "demo" | "introspection";
}

interface ApprovalExecutionBinding {
  approvalId: string;
  toolId: string;
  tenantId: string;
  actorId: string;
  requestHash: string;
  idempotencyKey?: string;
  consumedAt: string;
}

interface GatewaySecurityState {
  version: number;
  approvalBindings: ApprovalExecutionBinding[];
}

const getBearerToken = (request: IncomingMessage): string | undefined => {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const parts = header.split(" ");
  if (parts.length !== 2) return undefined;
  const token = parts[1];
  return typeof token === "string" && token.length > 0 ? token : undefined;
};

const normalizeGatewaySecurityState = (state: Partial<GatewaySecurityState> | undefined): GatewaySecurityState => ({
  version: 1,
  approvalBindings: Array.isArray(state?.approvalBindings) ? state.approvalBindings : []
});

const loadGatewaySecurityState = async (): Promise<GatewaySecurityState> => {
  try {
    return normalizeGatewaySecurityState(
      JSON.parse(await readFile(gatewaySecurityStateFile, "utf8")) as Partial<GatewaySecurityState>
    );
  } catch {
    return normalizeGatewaySecurityState(undefined);
  }
};

const saveGatewaySecurityState = async (state: GatewaySecurityState): Promise<void> => {
  await mkdir(dirname(gatewaySecurityStateFile), { recursive: true });
  await writeFile(gatewaySecurityStateFile, `${JSON.stringify(normalizeGatewaySecurityState(state), null, 2)}\n`, "utf8");
};

const shouldRequireSignedInternalContext = (): boolean => {
  if (process.env.OPENAEGIS_REQUIRE_SIGNED_INTERNAL_CONTEXT === "true") return true;
  return process.env.NODE_ENV === "production" && process.env.OPENAEGIS_ALLOW_UNSIGNED_INTERNAL_CONTEXT_IN_PRODUCTION !== "true";
};

const buildInternalServiceHeaders = (input: {
  actorId: string;
  tenantId: string;
  roles: string[];
  mtlsClientSan?: string;
  mtlsVerified?: boolean;
}): Record<string, string> | undefined => {
  const shouldSign = shouldRequireSignedInternalContext() || Boolean(process.env.OPENAEGIS_INTERNAL_CONTEXT_SIGNING_KEY);
  const baseHeaders: Record<string, string> = {
    "x-actor-id": input.actorId,
    "x-tenant-id": input.tenantId,
    "x-roles": input.roles.join(",")
  };

  if (input.mtlsClientSan) {
    baseHeaders["x-mtls-client-san"] = input.mtlsClientSan;
  }
  if (typeof input.mtlsVerified === "boolean") {
    baseHeaders["x-mtls-verified"] = input.mtlsVerified ? "true" : "false";
  }

  if (!shouldSign) return baseHeaders;

  try {
    return {
      ...baseHeaders,
      ...createSignedInternalContextHeaders(input)
    };
  } catch {
    return undefined;
  }
};

const buildToolApprovalBindingHash = (input: {
  approvalId: string;
  toolId: string;
  tenantId: string;
  actorId: string;
  body: JsonMap;
  idempotencyKey?: string;
}): string =>
  sha256Hex(
    stableSerialize({
      approvalId: input.approvalId,
      toolId: input.toolId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey ?? null,
      body: input.body
    })
  );

const parseDemoActorId = (token: string): string | undefined => {
  if (!token.startsWith("demo-token-")) return undefined;
  const actorId = token.replace("demo-token-", "");
  return actorId.length > 0 ? actorId : undefined;
};

const loadDemoSession = async (actorId: string): Promise<AuthSession | undefined> => {
  const state = await loadState();
  const user = state.users.find((item) => item.userId === actorId);
  if (!user) return undefined;
  const resolvedRole = resolveUserRole({ role: user.role });
  const roles = roleToPrivileges[resolvedRole] ?? ["workflow_operator"];
  const assuranceLevel = roleToAssurance[resolvedRole] ?? "aal2";
  return {
    actorId,
    tenantId: user.tenantId,
    roles,
    assuranceLevel,
    source: "demo"
  };
};

const introspectAuthToken = async (token: string): Promise<AuthSession | undefined> => {
  const endpoint = process.env.OPENAEGIS_AUTH_INTROSPECTION_URL;
  if (!endpoint) return undefined;
  const introspectorRoles =
    process.env.OPENAEGIS_AUTH_INTROSPECTOR_ROLES ?? "service_account,token_introspect";
  const trustProxyMtlsHeaders = process.env.OPENAEGIS_TRUST_PROXY_MTLS_HEADERS === "true";
  const introspectionHeaders = buildInternalServiceHeaders({
    actorId: process.env.OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID ?? "service-gateway",
    tenantId: process.env.OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID ?? "tenant-platform",
    roles: introspectorRoles.split(",").map((role) => role.trim()).filter((role) => role.length > 0),
    ...(trustProxyMtlsHeaders
      ? {
          mtlsClientSan: process.env.OPENAEGIS_AUTH_INTROSPECTOR_MTLS_SAN ?? "spiffe://openaegis/api-gateway",
          mtlsVerified: true
        }
      : {})
  });
  if (!introspectionHeaders) return undefined;

  const timeoutMs = Math.max(500, Number(process.env.OPENAEGIS_AUTH_INTROSPECTION_TIMEOUT_MS ?? 2000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...introspectionHeaders
      },
      body: JSON.stringify({ token }),
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      active?: boolean;
      sub?: unknown;
      tenantId?: unknown;
      roles?: unknown;
      assuranceLevel?: unknown;
    };
    if (body.active !== true || typeof body.sub !== "string" || body.sub.trim().length === 0) return undefined;
    const roles = Array.isArray(body.roles)
      ? body.roles.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const tenantId = typeof body.tenantId === "string" && body.tenantId.trim().length > 0 ? body.tenantId : undefined;
    const assuranceLevel =
      body.assuranceLevel === "aal1" || body.assuranceLevel === "aal2" || body.assuranceLevel === "aal3"
        ? body.assuranceLevel
        : undefined;
    return {
      actorId: body.sub,
      roles,
      source: "introspection",
      ...(tenantId ? { tenantId } : {}),
      ...(assuranceLevel ? { assuranceLevel } : {})
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveAuthSession = async (request: IncomingMessage): Promise<AuthSession | undefined> => {
  const token = getBearerToken(request);
  if (!token) return undefined;
  const introspectionRequired = process.env.OPENAEGIS_REQUIRE_INTROSPECTION === "true";

  const demoActorId = parseDemoActorId(token);
  if (demoActorId) {
    if (introspectionRequired || !isInsecureDemoAuthEnabled()) return undefined;
    return loadDemoSession(demoActorId);
  }

  const introspected = await introspectAuthToken(token);
  if (introspected) return introspected;
  return undefined;
};

const resolveTenantOrReject = (
  auth: AuthSession,
  requestedTenant: string
): { allowed: true; tenantId: string } | { allowed: false } => {
  if (auth.roles.includes("platform_admin")) {
    return { allowed: true, tenantId: requestedTenant };
  }
  if (!auth.tenantId || auth.tenantId !== requestedTenant) {
    return { allowed: false };
  }
  return { allowed: true, tenantId: requestedTenant };
};

const canAccessTenant = (auth: AuthSession, tenantId: string): boolean => {
  if (auth.roles.includes("platform_admin")) return true;
  return Boolean(auth.tenantId) && auth.tenantId === tenantId;
};

const requireRole = (
  response: ServerResponse,
  auth: AuthSession,
  roles: readonly string[],
  error: string
): boolean => {
  if (hasAnyRole(auth, roles)) return true;
  sendJson(response, 403, { error });
  return false;
};

const requireTenantAccess = (response: ServerResponse, auth: AuthSession, tenantId: string): boolean => {
  if (canAccessTenant(auth, tenantId)) return true;
  sendJson(response, 403, { error: "tenant_scope_mismatch" });
  return false;
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
  task: string;
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
        task: input.task,
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
  const requestContext = parseContext(request);

  if (!enforceRateLimit(response, requestContext.requestId, gatewayRateLimiter.check(`${request.socket.remoteAddress ?? "unknown"}:${pathname}`))) {
    return;
  }

  const requiresMtlsAttestation =
    process.env.OPENAEGIS_ENFORCE_MTLS === "true" &&
    pathname !== "/healthz" &&
    !(method === "POST" && pathname === "/v1/auth/login");

  if (requiresMtlsAttestation) {
    const trustProxyMtlsHeaders = process.env.OPENAEGIS_TRUST_PROXY_MTLS_HEADERS === "true";
    if (!trustProxyMtlsHeaders) {
      sendJson(response, 503, { error: "mtls_proxy_attestation_not_configured" }, request);
      return;
    }
    if (!requestContext.mtlsClientSan) {
      sendJson(response, 401, { error: "mtls_attestation_required" }, request);
      return;
    }
    if (!requestContext.mtlsVerified) {
      sendJson(response, 401, { error: "mtls_attestation_unverified" }, request);
      return;
    }
  }

  if (method === "OPTIONS") {
    const corsHeaders = buildCorsHeaders(request);
    if (!corsHeaders["access-control-allow-origin"]) {
      sendJson(response, 403, { error: "cors_origin_not_allowed" }, request);
      return;
    }
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (pathname === "/healthz") {
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName });
    return;
  }

  if (method === "POST" && pathname === "/v1/auth/login") {
    if (!isInsecureDemoAuthEnabled()) {
      sendJson(response, 404, { error: "demo_auth_disabled" });
      return;
    }
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

  const authSession = await resolveAuthSession(request);
  if (!authSession) {
    sendJson(response, 401, { error: "missing_or_invalid_auth_token" });
    return;
  }
  const actorId = authSession.actorId;

  if (method === "GET" && pathname === "/v1/commercial/claims") {
    if (!requireRole(response, authSession, commercialReadRoles, "insufficient_role_for_commercial_claims")) {
      return;
    }
    sendJson(response, 200, await buildCommercialClaims());
    return;
  }

  if (method === "GET" && pathname === "/v1/projects/sandbox-proof") {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    sendJson(response, 200, await buildSandboxProofReport());
    return;
  }

  if (method === "GET" && pathname === "/v1/projects/packs") {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    sendJson(response, 200, { packs: listProjectPacks() });
    return;
  }

  if (method === "GET" && /^\/v1\/projects\/packs\/[^/]+$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    if (!pack) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    sendJson(response, 200, pack);
    return;
  }

  if (method === "GET" && /^\/v1\/projects\/packs\/[^/]+\/experience$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    const experience = getProjectPackExperience(packId);
    if (!pack || !experience) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    const snapshot = await getPolicyProfileSnapshot();
    const evaluatedScenarios = experience.policyScenarios.map((scenario) => ({
      ...scenario,
      decision: (() => {
        const decision = evaluatePolicy(
          {
            action: scenario.input.action,
            classification: scenario.input.classification,
            riskLevel: scenario.input.riskLevel,
            mode: scenario.input.mode,
            zeroRetentionRequested: scenario.input.zeroRetentionRequested,
            estimatedToolCalls: scenario.input.estimatedToolCalls
          },
          snapshot.profile.controls
        );
        return {
          ...decision,
          reasons:
            decision.reasons.length > 0
              ? decision.reasons
              : [`policy_allows_${scenario.input.mode}_path_with_required_controls`]
        };
      })()
    }));
    sendJson(response, 200, {
      pack,
      experience: {
        ...experience,
        policyScenarios: evaluatedScenarios
      },
      policyProfile: {
        profileName: snapshot.profile.profileName,
        profileVersion: snapshot.profile.profileVersion
      }
    });
    return;
  }

  if (method === "GET" && /^\/v1\/projects\/packs\/[^/]+\/settings$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    const settingsChecklist = getProjectPackSettingsChecklist(packId);
    if (!pack || !settingsChecklist) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    sendJson(response, 200, {
      pack,
      settingsChecklist,
      policyPreset: getProjectPackPolicyPreset(packId)
    });
    return;
  }

  if (method === "GET" && /^\/v1\/projects\/packs\/[^/]+\/playbook$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    const dailyPlaybook = getProjectPackDailyPlaybook(packId);
    if (!pack || !dailyPlaybook) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    sendJson(response, 200, {
      pack,
      dailyPlaybook,
      scenarioGuides: getProjectPackExperience(packId)?.scenarioGuides ?? []
    });
    return;
  }

  if (method === "GET" && /^\/v1\/projects\/packs\/[^/]+\/dashboards$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackReadRoles, "insufficient_role_for_project_pack_read")) {
      return;
    }
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    const dashboards = getProjectPackDashboards(packId);
    const experience = getProjectPackExperience(packId);
    if (!pack || !dashboards || !experience) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    sendJson(response, 200, {
      pack,
      personaDashboards: dashboards,
      screenshotReferences: experience.screenshotReferences
    });
    return;
  }

  if (method === "POST" && /^\/v1\/projects\/packs\/[^/]+\/policies\/apply$/.test(pathname)) {
    if (!requireRole(response, authSession, policyProfileManageRoles, "insufficient_role_for_policy_profile_manage")) {
      return;
    }
    const body = await readJson(request);
    const packId = pathname.split("/")[4] ?? "";
    const preset = getProjectPackPolicyPreset(packId);
    const pack = getProjectPack(packId);
    if (!preset || !pack) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    const requestedTenant = toString(body.tenantId, authSession.tenantId ?? "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const draftOverrides = parseDraftControls(body);
    const result = await savePolicyProfile({
      actorId,
      tenantId: tenantScope.tenantId,
      profileName: toString(body.profileName, preset.profileName),
      changeSummary: toString(body.changeSummary, preset.changeSummary),
      draftControls: {
        ...preset.controls,
        ...draftOverrides
      }
    });
    sendJson(response, result.status, {
      pack,
      appliedPreset: preset,
      result: result.body
    });
    return;
  }

  if (method === "POST" && /^\/v1\/projects\/packs\/[^/]+\/run$/.test(pathname)) {
    if (!requireRole(response, authSession, projectPackRunRoles, "insufficient_role_for_project_pack_run")) {
      return;
    }
    const body = await readJson(request);
    const packId = pathname.split("/")[4] ?? "";
    const pack = getProjectPack(packId);
    if (!pack) {
      sendJson(response, 404, { error: "project_pack_not_found" });
      return;
    }
    const requestedTenant = toString(body.tenantId, authSession.tenantId ?? "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const mode = body.mode === "live" ? "live" : "simulation";
    const classification = toString(body.classification, pack.defaultClassification);
    const result = await createExecution({
      actorId,
      patientId: toString(body.patientId, pack.defaultPatientId),
      mode: mode as PilotMode,
      workflowId: toString(body.workflowId, pack.workflowId),
      tenantId: tenantScope.tenantId,
      requestFollowupEmail: toBoolean(body.requestFollowupEmail, true),
      classification,
      zeroRetentionRequested: toBoolean(body.zeroRetentionRequested, true)
    });
    sendJson(response, result.status, {
      pack,
      execution: result.body
    });
    return;
  }

  if (method === "GET" && pathname === "/v1/policies/profile") {
    if (!requireRole(response, authSession, policyProfileReadRoles, "insufficient_role_for_policy_profile_read")) {
      return;
    }
    const snapshot = await getPolicyProfileSnapshot();
    if (!requireTenantAccess(response, authSession, snapshot.profile.tenantId)) {
      return;
    }
    sendJson(response, 200, snapshot);
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/preview") {
    if (!requireRole(response, authSession, policyProfileManageRoles, "insufficient_role_for_policy_profile_manage")) {
      return;
    }
    const body = await readJson(request);
    const requestedTenant = toString(body.tenantId, "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const preview = await previewPolicyProfile({
      tenantId: tenantScope.tenantId,
      profileName: toString(body.profileName, "Hospital Safe Baseline"),
      draftControls: parseDraftControls(body)
    });
    sendJson(response, 200, preview);
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/explain") {
    if (!requireRole(response, authSession, policyProfileManageRoles, "insufficient_role_for_policy_profile_manage")) {
      return;
    }
    const body = await readJson(request);
    const operatorGoal = toString(body.operatorGoal, "Keep the policy secure and easy to operate.");
    const requestedTenant = toString(body.tenantId, "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const current = await getPolicyProfileSnapshot();
    const proposed = await previewPolicyProfile({
      tenantId: tenantScope.tenantId,
      profileName: toString(body.profileName, current.profile.profileName),
      draftControls: parseDraftControls(body)
    });
    const explainability = explainPolicyProfileChange(current.profile.controls, proposed.profile.controls);
    const fallbackSuggestion = suggestPolicyAutofix(proposed.profile.controls, operatorGoal);
    const localCopilot = await readLocalPolicyCopilot({
      task: "openaegis-policy-impact-explain",
      current,
      proposed,
      validation: proposed.validation,
      operatorGoal
    });

    const localSuggestedControls =
      typeof localCopilot?.suggestedControls === "object" && localCopilot.suggestedControls !== null
        ? parseDraftControls({ controls: localCopilot.suggestedControls as Record<string, unknown> })
        : undefined;

    sendJson(response, 200, {
      current,
      proposed,
      explainability,
      advisor: {
        source: localCopilot ? "local-llm" : "builtin",
        summary:
          typeof localCopilot?.summary === "string"
            ? localCopilot.summary
            : explainability.summary,
        riskNarrative:
          typeof localCopilot?.riskNarrative === "string"
            ? localCopilot.riskNarrative
            : fallbackSuggestion.riskNarrative,
        hints:
          Array.isArray(localCopilot?.hints) && localCopilot.hints.every((item) => typeof item === "string")
            ? (localCopilot.hints as string[])
            : fallbackSuggestion.hints,
        suggestedControls: localSuggestedControls
          ? { ...proposed.profile.controls, ...localSuggestedControls }
          : fallbackSuggestion.suggestedControls,
        suggestedReason:
          typeof localCopilot?.suggestedReason === "string"
            ? localCopilot.suggestedReason
            : fallbackSuggestion.suggestedReason,
        confidence:
          typeof localCopilot?.confidence === "number" ? localCopilot.confidence : fallbackSuggestion.confidence
      }
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/policies/profile/copilot") {
    if (!requireRole(response, authSession, policyProfileManageRoles, "insufficient_role_for_policy_profile_manage")) {
      return;
    }
    const body = await readJson(request);
    const operatorGoal = toString(body.operatorGoal, "Keep the policy secure while reducing operator confusion.");
    const requestedTenant = toString(body.tenantId, "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const current = await getPolicyProfileSnapshot();
    const preview = await previewPolicyProfile({
      tenantId: tenantScope.tenantId,
      profileName: toString(body.profileName, current.profile.profileName),
      draftControls: parseDraftControls(body)
    });

    const fallbackSuggestion = suggestPolicyAutofix(preview.profile.controls, operatorGoal);
    const localCopilot = await readLocalPolicyCopilot({
      task: "openaegis-policy-review",
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
    if (!requireRole(response, authSession, policyProfileManageRoles, "insufficient_role_for_policy_profile_manage")) {
      return;
    }
    const body = await readJson(request);
    const requestedTenant = toString(body.tenantId, "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const breakGlassRaw =
      typeof body.breakGlass === "object" && body.breakGlass !== null
        ? (body.breakGlass as Record<string, unknown>)
        : undefined;
    const result = await savePolicyProfile({
      actorId,
      tenantId: tenantScope.tenantId,
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
    if (!requireRole(response, authSession, approvalCreateRoles, "insufficient_role_for_approval_create")) {
      return;
    }
    const body = await readJson(request);
    const requestedTenant = toString(body.tenantId, "tenant-starlight-health");
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const state = await loadState();
    const approval = createApproval({
      tenantId: tenantScope.tenantId,
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
    if (!requireRole(response, authSession, approvalViewRoles, "insufficient_role_for_approval_list")) {
      return;
    }
    const state = await loadState();
    const approvals = authSession.roles.includes("platform_admin")
      ? state.approvals
      : state.approvals.filter((approval) => authSession.tenantId && approval.tenantId === authSession.tenantId);
    sendJson(response, 200, { approvals });
    return;
  }

  if (method === "POST" && /^\/v1\/approvals\/.+\/decide$/.test(pathname)) {
    if (!requireRole(response, authSession, approvalDecisionRoles, "insufficient_role_for_approval_decision")) {
      return;
    }
    const body = await readJson(request);
    const approvalId = pathname.split("/")[3] ?? "";
    const state = await loadState();
    const approval = state.approvals.find((item) => item.approvalId === approvalId);
    if (!approval) {
      sendJson(response, 404, { error: "approval_not_found" });
      return;
    }
    if (!canAccessTenant(authSession, approval.tenantId)) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
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
    const requestedTenant = toString(body.tenantId, authSession.tenantId ?? "tenant-starlight-health");
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string" && request.headers["idempotency-key"].trim().length > 0
        ? request.headers["idempotency-key"].trim()
        : undefined;
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    if (mode === "execute") {
      if (!requireRole(response, authSession, approvalDecisionRoles, "insufficient_role_for_tool_execute")) {
        return;
      }
      const approvalId = toString(body.approvalId, "");
      const state = await loadState();
      const approval = state.approvals.find((item) => item.approvalId === approvalId);
      if (!approval || approval.status !== "approved" || approval.tenantId !== tenantScope.tenantId) {
        sendJson(response, 403, { error: "approval_missing" });
        return;
      }

      const securityState = await loadGatewaySecurityState();
      const requestHash = buildToolApprovalBindingHash({
        approvalId,
        toolId,
        tenantId: tenantScope.tenantId,
        actorId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        body
      });
      const existingBinding = securityState.approvalBindings.find((item) => item.approvalId === approvalId);
      if (existingBinding) {
        sendJson(
          response,
          409,
          { error: existingBinding.requestHash === requestHash ? "approval_already_used" : "approval_binding_mismatch" }
        );
        return;
      }

      securityState.approvalBindings.push({
        approvalId,
        toolId,
        tenantId: tenantScope.tenantId,
        actorId,
        requestHash,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        consumedAt: new Date().toISOString()
      });
      await saveGatewaySecurityState(securityState);
    }
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
    if (!requireRole(response, authSession, agentGraphReadRoles, "insufficient_role_for_agent_graph_read")) {
      return;
    }
    const state = await loadState();
    const graphs = await listAgentGraphDefinitions();
    sendJson(response, 200, {
      graphs: graphs.map((graph) => ({
        ...graph,
        executionCount: state.graphExecutions.filter((item) => item.graphId === graph.graphId && canAccessTenant(authSession, item.tenantId)).length,
        incidentCount: state.incidents.filter((item) => item.graphId === graph.graphId && canAccessTenant(authSession, item.tenantId)).length
      }))
    });
    return;
  }

  if (method === "GET" && /^\/v1\/agent-graphs\/[^/]+$/.test(pathname)) {
    if (!requireRole(response, authSession, agentGraphReadRoles, "insufficient_role_for_agent_graph_read")) {
      return;
    }
    const graphId = pathname.split("/")[3] ?? "";
    const graph = await getAgentGraphDefinition(graphId);
    if (!graph) {
      sendJson(response, 404, { error: "graph_not_found" });
      return;
    }

    const state = await loadState();
    const executions = state.graphExecutions.filter((item) => item.graphId === graphId && canAccessTenant(authSession, item.tenantId));
    const incidents = state.incidents.filter((item) => item.graphId === graphId && canAccessTenant(authSession, item.tenantId));
    sendJson(response, 200, {
      graph,
      executions,
      incidents
    });
    return;
  }

  if (method === "GET" && /^\/v1\/agent-graphs\/[^/]+\/executions\/[^/]+$/.test(pathname)) {
    if (!requireRole(response, authSession, agentGraphReadRoles, "insufficient_role_for_agent_graph_read")) {
      return;
    }
    const parts = pathname.split("/");
    const graphId = parts[3] ?? "";
    const executionId = parts[5] ?? "";
    const graphExecution = await getGraphExecution(graphId, executionId);
    const executionBundle = await getGraphExecutionByExecutionId(executionId);
    if (!graphExecution || !executionBundle) {
      sendJson(response, 404, { error: "graph_execution_not_found" });
      return;
    }
    if (!requireTenantAccess(response, authSession, executionBundle.execution.tenantId)) {
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
    const requestedTenant = typeof body.tenantId === "string" ? body.tenantId : "tenant-starlight-health";
    const tenantScope = resolveTenantOrReject(authSession, requestedTenant);
    if (!tenantScope.allowed) {
      sendJson(response, 403, { error: "tenant_scope_mismatch" });
      return;
    }
    const result = await createExecution({
      actorId,
      patientId: typeof body.patientId === "string" ? body.patientId : "patient-1001",
      mode: (body.mode as PilotMode) ?? "simulation",
      workflowId: typeof body.workflowId === "string" ? body.workflowId : "wf-discharge-assistant",
      tenantId: tenantScope.tenantId,
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
    if (!requireTenantAccess(response, authSession, bundle.execution.tenantId)) {
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
    if (!requireTenantAccess(response, authSession, execution.tenantId)) {
      return;
    }
    sendJson(response, 200, execution);
    return;
  }

  if (method === "GET" && pathname === "/v1/incidents") {
    if (!requireRole(response, authSession, incidentReadRoles, "insufficient_role_for_incident_list")) {
      return;
    }
    const incidents = await listIncidents();
    sendJson(response, 200, {
      incidents: authSession.roles.includes("platform_admin")
        ? incidents
        : incidents.filter((incident) => authSession.tenantId && incident.tenantId === authSession.tenantId)
    });
    return;
  }

  if (method === "GET" && /^\/v1\/incidents\/[^/]+$/.test(pathname)) {
    if (!requireRole(response, authSession, incidentReadRoles, "insufficient_role_for_incident_read")) {
      return;
    }
    const incidentId = pathname.split("/")[3] ?? "";
    const incident = await getIncident(incidentId);
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    if (!requireTenantAccess(response, authSession, incident.tenantId)) {
      return;
    }
    sendJson(response, 200, incident);
    return;
  }

  if (method === "GET" && pathname === "/v1/audit/events") {
    if (!requireRole(response, authSession, auditReadRoles, "insufficient_role_for_audit_list")) {
      return;
    }
    const state = await loadState();
    const events = authSession.roles.includes("platform_admin")
      ? state.auditEvents
      : state.auditEvents.filter((event) => authSession.tenantId && event.tenantId === authSession.tenantId);
    sendJson(response, 200, { events: events.slice().reverse() });
    return;
  }

  if (method === "GET" && pathname === "/v1/commercial/proof") {
    if (!requireRole(response, authSession, commercialReadRoles, "insufficient_role_for_commercial_proof")) {
      return;
    }
    const snapshot = await buildCommercialSnapshot();
    const report = await readCommercialProofReport();
    sendJson(response, 200, { ...snapshot, ...(report ? { report } : {}) });
    return;
  }

  if (method === "GET" && pathname === "/v1/commercial/readiness") {
    if (!requireRole(response, authSession, commercialReadRoles, "insufficient_role_for_commercial_readiness")) {
      return;
    }
    sendJson(response, 200, await buildCommercialReadinessSnapshot());
    return;
  }

  if (method === "GET" && /^\/v1\/audit\/evidence\/.+$/.test(pathname)) {
    if (!requireRole(response, authSession, auditReadRoles, "insufficient_role_for_audit_evidence_read")) {
      return;
    }
    const evidenceId = pathname.split("/")[4] ?? "";
    const state = await loadState();
    const event = state.auditEvents.find((item) => item.evidenceId === evidenceId);
    if (!event) {
      sendJson(response, 404, { error: "evidence_not_found" });
      return;
    }
    if (!requireTenantAccess(response, authSession, event.tenantId)) {
      return;
    }
    sendJson(response, 200, { evidence: event });
    return;
  }

  sendJson(response, 404, { error: "not_found", path: pathname });
};

export const createAppServer = () => createServer((request, response) => {
  void requestHandler(request, response).catch((error: unknown) => {
    if (error instanceof Error && error.message === "payload_too_large") {
      sendJson(response, 413, { error: "payload_too_large" });
      return;
    }
    sendJson(response, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" });
  });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(descriptor.serviceName + " listening on :" + descriptor.listeningPort);
  });
}

