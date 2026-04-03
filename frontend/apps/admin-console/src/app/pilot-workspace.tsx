import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  pilotApi,
  type ApprovalRecord,
  type AuditEvent,
  type CommercialClaimsSnapshot,
  type CommercialProofSnapshot,
  type CommercialReadinessSnapshot,
  type ExecutionRecord,
  type LoginResponse,
  type ModelRoutePreview,
  type PolicyCopilotReview,
  type PolicyProfileControls,
  type PolicyProfileSnapshot,
  type PolicyImpactReview,
  type ProjectPackDefinition,
  type ProjectPackExperienceResponse
} from "../shared/api/pilot.js";
import { isDemoIdentitiesEnabled } from "./security-guards.js";
import { workspacePersistSnapshot } from "./workspace-persistence.js";
import {
  DEMO_PERSONAS,
  DEMO_ADMIN_EMAIL,
  PILOT_USE_CASE,
  AGENT_BLUEPRINTS,
  CONNECTOR_BLUEPRINTS,
  EXECUTIVE_KPIS,
  INTEGRATION_BLUEPRINTS,
  POLICY_BLUEPRINTS,
  WORKFLOW_BLUEPRINTS
} from "./pilot-data.js";

type PersonaKey = "clinician" | "security";
type Decision = "approve" | "reject";
type IntegrationId = "databricks" | "fabric" | "snowflake" | "aws";
type IntegrationStatus = "not_configured" | "configured" | "verifying" | "verified" | "error";
const INTEGRATION_SECRET_FIELDS: Record<IntegrationId, string[]> = {
  databricks: ["token"],
  fabric: ["clientSecret"],
  snowflake: ["privateKey"],
  aws: ["externalId"]
};

export interface IntegrationProfile {
  integrationId: IntegrationId;
  name: string;
  status: IntegrationStatus;
  configuredAt?: string | undefined;
  verifiedAt?: string | undefined;
  lastError?: string | undefined;
  config: Record<string, string>;
}

export interface DirectoryUser {
  userId: string;
  displayName: string;
  email: string;
  tenantId: string;
  assuranceLevel: "aal1" | "aal2" | "aal3";
  roles: string[];
  status: "active" | "disabled";
  source: "seeded" | "session" | "manual";
  updatedAt: string;
}

export interface IncidentRecord {
  incidentId: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "contained" | "resolved";
  source: "execution" | "approval" | "audit";
  summary: string;
  recommendation: string;
  evidenceId: string;
  executionId: string | undefined;
  approvalId: string | undefined;
  detectedAt: string;
  signals: string[];
  timeline: Array<{ at: string; label: string; detail: string }>;
}

interface WorkspaceState {
  clinicianSession?: LoginResponse;
  securitySession?: LoginResponse;
  activePersona: PersonaKey;
  trackedExecutionIds: string[];
  executions: ExecutionRecord[];
  approvals: ApprovalRecord[];
  auditEvents: AuditEvent[];
  incidents: IncidentRecord[];
  commercialProof?: CommercialProofSnapshot;
  commercialClaims?: CommercialClaimsSnapshot;
  commercialReadiness?: CommercialReadinessSnapshot;
  projectPacks: ProjectPackDefinition[];
  projectPackExperiences: Partial<Record<ProjectPackDefinition["packId"], ProjectPackExperienceResponse>>;
  policySnapshot?: PolicyProfileSnapshot;
  policyCopilot?: PolicyCopilotReview;
  policyImpactReview?: PolicyImpactReview;
  modelPreview?: { selected: ModelRoutePreview; fallback: ModelRoutePreview[] };
  integrations: IntegrationProfile[];
  directoryUsers: DirectoryUser[];
  lastSyncedAt?: string;
  isBootstrapping: boolean;
  isSyncing: boolean;
  error: string | undefined;
}

interface WorkspaceActions {
  connectDemoUsers: () => Promise<void>;
  initializePlatform: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  runWorkflow: (mode: "simulation" | "live", requestFollowupEmail?: boolean) => Promise<ExecutionRecord | null>;
  runProjectPack: (
    packId: ProjectPackDefinition["packId"],
    mode: "simulation" | "live",
    options?: {
      requestFollowupEmail?: boolean;
      classification?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
      zeroRetentionRequested?: boolean;
    }
  ) => Promise<ExecutionRecord | null>;
  loadProjectPackExperience: (packId: ProjectPackDefinition["packId"]) => Promise<ProjectPackExperienceResponse | null>;
  applyProjectPackPolicyPreset: (packId: ProjectPackDefinition["packId"]) => Promise<PolicyProfileSnapshot | null>;
  decideApproval: (approvalId: string, decision: Decision, reason: string) => Promise<ApprovalRecord | null>;
  previewPolicy: (controls: Partial<PolicyProfileControls>, profileName?: string) => Promise<PolicyProfileSnapshot | null>;
  reviewPolicyWithCopilot: (controls: Partial<PolicyProfileControls>, operatorGoal: string, profileName?: string) => Promise<PolicyCopilotReview | null>;
  explainPolicy: (controls: Partial<PolicyProfileControls>, operatorGoal?: string, profileName?: string) => Promise<PolicyImpactReview | null>;
  savePolicy: (payload: {
    controls: Partial<PolicyProfileControls>;
    changeSummary: string;
    profileName?: string;
    breakGlass?: { ticketId: string; justification: string; approverIds: string[] };
  }) => Promise<PolicyProfileSnapshot | null>;
  configureIntegration: (integrationId: IntegrationId, values: Record<string, string>) => void;
  verifyIntegration: (integrationId: IntegrationId) => Promise<boolean>;
  saveDirectoryUser: (payload: {
    userId?: string;
    displayName: string;
    email: string;
    roles: string[];
    assuranceLevel: "aal1" | "aal2" | "aal3";
    tenantId?: string;
  }) => void;
  setDirectoryUserStatus: (userId: string, status: "active" | "disabled") => void;
  setActivePersona: (persona: PersonaKey) => void;
  clearError: () => void;
  boot: () => Promise<void>;
}

export type PilotWorkspace = WorkspaceState & WorkspaceActions;

const storageKey = "openaegis.admin-console.workspace";
const memoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    key: (index) => Array.from(entries.keys())[index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    }
  };
};
const fallbackStorage = memoryStorage();
const createWorkspaceStorage = (): Storage => {
  const baseStorage = typeof localStorage === "undefined" ? fallbackStorage : localStorage;
  return {
    get length() {
      return baseStorage.length;
    },
    clear: () => baseStorage.clear(),
    key: (index) => baseStorage.key(index),
    getItem: (key) => {
      const raw = baseStorage.getItem(key);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
        if (!parsed || typeof parsed !== "object" || !parsed.state || typeof parsed.state !== "object") {
          return raw;
        }
        const { clinicianSession: _clinicianSession, securitySession: _securitySession, ...sanitizedState } = parsed.state;
        if ("clinicianSession" in parsed.state || "securitySession" in parsed.state) {
          const sanitized = JSON.stringify({ ...parsed, state: sanitizedState });
          if (sanitized !== raw) {
            baseStorage.setItem(key, sanitized);
          }
          return sanitized;
        }
      } catch {
        return raw;
      }
      return raw;
    },
    setItem: (key, value) => {
      baseStorage.setItem(key, value);
    },
    removeItem: (key) => {
      baseStorage.removeItem(key);
    }
  };
};

const toIso = () => new Date().toISOString();

const sortLatestFirst = <T extends { updatedAt?: string; createdAt?: string }>(items: T[]) =>
  items.slice().sort((left, right) => {
    const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });

const getPrimaryToken = (state: Pick<WorkspaceState, "clinicianSession" | "securitySession">) =>
  state.clinicianSession?.accessToken ?? state.securitySession?.accessToken;

const summarizeApprovalTimeline = (approval: ApprovalRecord) => [
  { at: approval.createdAt, label: "Requested", detail: `${approval.reason} (${approval.riskLevel})` },
  ...(approval.approvers.length > 0
    ? approval.approvers.map((approver) => ({
        at: approver.decidedAt,
        label: approver.decision === "approved" ? "Approved" : "Rejected",
        detail: approver.reason ?? `Decision by ${approver.approverId}`
      }))
    : [])
];

const deriveIncidents = (executions: ExecutionRecord[], approvals: ApprovalRecord[], auditEvents: AuditEvent[]): IncidentRecord[] => {
  const incidents: IncidentRecord[] = [];

  for (const execution of executions) {
    if (execution.status === "blocked") {
      incidents.push({
        incidentId: `incident-${execution.executionId}`,
        title: `Blocked live execution ${execution.executionId}`,
        severity: "high",
        status: "open",
        source: "execution",
        summary: execution.blockedReason ?? "Execution paused for human approval.",
        recommendation: "Review the approval inbox, approve or reject explicitly, then replay the execution with evidence.",
        evidenceId: execution.evidenceId,
        executionId: execution.executionId,
        approvalId: execution.approvalId,
        detectedAt: execution.updatedAt,
        signals: [
          `mode:${execution.mode}`,
          `step:${execution.currentStep}`,
          ...(execution.modelRoute?.reasonCodes ?? [])
        ],
        timeline: [
          { at: execution.createdAt, label: "Started", detail: `Workflow ${execution.workflowId} entered runtime.` },
          { at: execution.updatedAt, label: "Blocked", detail: execution.blockedReason ?? "Approval required." }
        ]
      });
    }

    if (execution.status === "failed") {
      incidents.push({
        incidentId: `incident-${execution.executionId}-failed`,
        title: `Execution failure ${execution.executionId}`,
        severity: "critical",
        status: "open",
        source: "execution",
        summary: "The workflow failed before completion and should be investigated immediately.",
        recommendation: "Inspect the audit trail, replay in simulation mode, and verify connector/tool health.",
        evidenceId: execution.evidenceId,
        executionId: execution.executionId,
        approvalId: execution.approvalId,
        detectedAt: execution.updatedAt,
        signals: execution.toolCalls,
        timeline: [{ at: execution.updatedAt, label: "Failed", detail: "Execution reached a terminal failure state." }]
      });
    }
  }

  for (const approval of approvals) {
    if (approval.status === "rejected") {
      incidents.push({
        incidentId: `incident-${approval.approvalId}`,
        title: `Rejected approval ${approval.approvalId}`,
        severity: approval.riskLevel === "critical" ? "critical" : "high",
        status: "contained",
        source: "approval",
        summary: approval.reason,
        recommendation: "Document the rejection rationale and ensure the workflow stays blocked.",
        evidenceId: `ev-${approval.approvalId}`,
        executionId: approval.executionId,
        approvalId: approval.approvalId,
        detectedAt: approval.createdAt,
        signals: [`risk:${approval.riskLevel}`, `approvers:${approval.requiredApprovers}`],
        timeline: summarizeApprovalTimeline(approval)
      });
    }
  }

  for (const event of auditEvents) {
    if (event.status === "blocked") {
      incidents.push({
        incidentId: `incident-${event.eventId}`,
        title: `Blocked audit event ${event.action}`,
        severity: "medium",
        status: "contained",
        source: "audit",
        summary: `Audit recorded a blocked action for ${event.action}.`,
        recommendation: "Review the policy decision attached to the event details and confirm the control is expected.",
        evidenceId: event.evidenceId,
        executionId: typeof event.details.executionId === "string" ? event.details.executionId : undefined,
        approvalId: typeof event.details.approvalId === "string" ? event.details.approvalId : undefined,
        detectedAt: event.timestamp,
        signals: [`category:${event.category}`, `action:${event.action}`],
        timeline: [{ at: event.timestamp, label: "Blocked", detail: JSON.stringify(event.details) }]
      });
    }
  }

  return incidents.sort((left, right) => {
    const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const leftRank = severityRank[left.severity];
    const rightRank = severityRank[right.severity];
    if (leftRank !== rightRank) return leftRank - rightRank;
    return new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime();
  });
};

const buildDefaultIntegrations = (): IntegrationProfile[] =>
  INTEGRATION_BLUEPRINTS.map((integration) => ({
    integrationId: integration.integrationId,
    name: integration.name,
    status: "not_configured",
    config: {}
  }));

const defaultDirectoryUsers = (): DirectoryUser[] => [
  {
    userId: "user-platform-owner",
    displayName: "Platform Owner",
    email: DEMO_ADMIN_EMAIL,
    tenantId: PILOT_USE_CASE.tenantId,
    assuranceLevel: "aal3",
    roles: ["platform_admin", "security_admin", "auditor"],
    status: "active",
    source: "seeded",
    updatedAt: toIso()
  },
  ...DEMO_PERSONAS.map<DirectoryUser>((persona) => ({
    userId: persona.key === "clinician" ? "user-clinician" : "user-security",
    displayName: persona.key === "clinician" ? "Clinician Operator" : "Security Reviewer",
    email: persona.email,
    tenantId: PILOT_USE_CASE.tenantId,
    assuranceLevel: persona.key === "clinician" ? "aal2" : "aal3",
    roles: persona.key === "clinician" ? ["workflow_operator", "analyst"] : ["security_admin", "approver", "auditor"],
    status: "active",
    source: "seeded",
    updatedAt: toIso()
  }))
];

export const usePilotWorkspace = create<PilotWorkspace>()(
  persist(
    (set, get) => ({
      activePersona: "clinician",
      trackedExecutionIds: [],
      executions: [],
      approvals: [],
      auditEvents: [],
      incidents: [],
      projectPacks: [],
      projectPackExperiences: {},
      integrations: buildDefaultIntegrations(),
      directoryUsers: defaultDirectoryUsers(),
      isBootstrapping: false,
      isSyncing: false,
      error: undefined,
      clearError: () => set({ error: undefined }),
      setActivePersona: (persona) => set({ activePersona: persona }),
      configureIntegration: (integrationId, values) =>
        set((state) => ({
          integrations: state.integrations.map((integration) =>
            integration.integrationId === integrationId
              ? {
                  ...integration,
                  config: { ...integration.config, ...values },
                  status: "configured",
                  configuredAt: toIso(),
                  lastError: undefined
                }
              : integration
          )
        })),
      verifyIntegration: async (integrationId) => {
        const integration = get().integrations.find((item) => item.integrationId === integrationId);
        const blueprint = INTEGRATION_BLUEPRINTS.find((item) => item.integrationId === integrationId);
        if (!integration || !blueprint) return false;

        set((state) => ({
          integrations: state.integrations.map((item) =>
            item.integrationId === integrationId ? { ...item, status: "verifying", lastError: undefined } : item
          )
        }));

        await new Promise((resolve) => setTimeout(resolve, 450));
        const hasSessions = Boolean(get().clinicianSession || get().securitySession);
        const missingField = blueprint.requiredFields.find((field) => !(integration.config[field] ?? "").trim());
        const invalidSecretField = INTEGRATION_SECRET_FIELDS[integrationId].find((field) => {
          const value = (integration.config[field] ?? "").trim();
          return value.length > 0 && !value.startsWith("vault://");
        });
        const success = hasSessions && !missingField;
        const securityCompliant = !invalidSecretField;

        set((state) => ({
          integrations: state.integrations.map((item) =>
            item.integrationId === integrationId
              ? {
                  ...item,
                  status: success && securityCompliant ? "verified" : "error",
                  verifiedAt: success && securityCompliant ? toIso() : item.verifiedAt,
                  lastError: success && securityCompliant
                    ? undefined
                    : !hasSessions
                      ? "Connect evaluator identities first to validate identity and policy context."
                      : invalidSecretField
                        ? `Secret field ${invalidSecretField} must reference secrets broker (vault://...).`
                      : `Missing required field: ${missingField}`
                }
              : item
          )
        }));

        return success && securityCompliant;
      },
      saveDirectoryUser: (payload) =>
        set((state) => {
          const userId = payload.userId ?? `user-${Math.random().toString(36).slice(2, 9)}`;
          const existing = state.directoryUsers.find((item) => item.userId === userId);
          const next: DirectoryUser = {
            userId,
            displayName: payload.displayName,
            email: payload.email,
            tenantId: payload.tenantId ?? PILOT_USE_CASE.tenantId,
            assuranceLevel: payload.assuranceLevel,
            roles: payload.roles,
            status: existing?.status ?? "active",
            source: existing?.source ?? "manual",
            updatedAt: toIso()
          };
          return {
            directoryUsers: existing
              ? state.directoryUsers.map((item) => (item.userId === userId ? next : item))
              : sortLatestFirst([next, ...state.directoryUsers])
          };
        }),
      setDirectoryUserStatus: (userId, status) =>
        set((state) => ({
          directoryUsers: state.directoryUsers.map((item) =>
            item.userId === userId ? { ...item, status, updatedAt: toIso() } : item
          )
        })),
      connectDemoUsers: async () => {
        if (!isDemoIdentitiesEnabled()) {
          set({ error: "demo_identities_disabled_in_this_build" });
          return;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const [clinicianSession, securitySession] = await Promise.all([
            pilotApi.login(DEMO_PERSONAS[0]!.email),
            pilotApi.login(DEMO_PERSONAS[1]!.email)
          ]);

          set({
            clinicianSession,
            securitySession,
            activePersona: "clinician",
            directoryUsers: sortLatestFirst([
              ...get().directoryUsers.filter(
                (user) => user.userId !== clinicianSession.user.userId && user.userId !== securitySession.user.userId
              ),
              {
                userId: clinicianSession.user.userId,
                displayName: clinicianSession.user.displayName,
                email: clinicianSession.user.email,
                tenantId: clinicianSession.user.tenantId,
                assuranceLevel: clinicianSession.user.assuranceLevel,
                roles: clinicianSession.user.roles,
                status: "active",
                source: "session",
                updatedAt: toIso()
              },
              {
                userId: securitySession.user.userId,
                displayName: securitySession.user.displayName,
                email: securitySession.user.email,
                tenantId: securitySession.user.tenantId,
                assuranceLevel: securitySession.user.assuranceLevel,
                roles: securitySession.user.roles,
                status: "active",
                source: "session",
                updatedAt: toIso()
              }
            ]),
            error: undefined
          });
          await get().refreshWorkspace();
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "login_failed" });
        } finally {
          set({ isSyncing: false });
        }
      },
      initializePlatform: async () => {
        set({ isSyncing: true, error: undefined });
        try {
          const hasSessions = Boolean(get().clinicianSession && get().securitySession);
          if (!hasSessions) {
            await get().connectDemoUsers();
          }

          const stateAfterConnect = get();
          if (stateAfterConnect.executions.length === 0 && stateAfterConnect.clinicianSession?.accessToken) {
            await get().runWorkflow("simulation");
          } else {
            await get().refreshWorkspace();
          }
          set({ error: undefined });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "platform_initialization_failed" });
        } finally {
          set({ isSyncing: false });
        }
      },
      refreshWorkspace: async () => {
        const clinicianToken = get().clinicianSession?.accessToken ?? get().securitySession?.accessToken;
        const securityToken = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!clinicianToken && !securityToken) {
          set({ error: "setup_required_connect_identities" });
          return;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const [
            approvalsResponse,
            auditResponse,
            previewResponse,
            commercialProof,
            commercialClaims,
            commercialReadiness,
            policySnapshot,
            projectPacks
          ] = await Promise.all([
            securityToken ? pilotApi.listApprovals(securityToken).catch(() => ({ approvals: [] })) : Promise.resolve({ approvals: [] }),
            securityToken ? pilotApi.listAuditEvents(securityToken).catch(() => ({ events: [] })) : Promise.resolve({ events: [] }),
            clinicianToken ? pilotApi.previewModelRoute(clinicianToken).catch(() => undefined) : Promise.resolve(undefined),
            securityToken ? pilotApi.getCommercialProof(securityToken).catch(() => undefined) : Promise.resolve(undefined),
            securityToken ? pilotApi.getCommercialClaims(securityToken).catch(() => undefined) : Promise.resolve(undefined),
            securityToken ? pilotApi.getCommercialReadiness(securityToken).catch(() => undefined) : Promise.resolve(undefined),
            securityToken ? pilotApi.getPolicyProfile(securityToken).catch(() => undefined) : Promise.resolve(undefined),
            (clinicianToken ?? securityToken)
              ? pilotApi.listProjectPacks(clinicianToken ?? securityToken!).catch(() => ({ packs: [] }))
              : Promise.resolve({ packs: [] })
          ]);
          const experienceEntries = await Promise.all(
            projectPacks.packs.map(async (pack) => {
              try {
                const response = await pilotApi.getProjectPackExperience(clinicianToken ?? securityToken!, pack.packId);
                return [pack.packId, response] as const;
              } catch {
                return null;
              }
            })
          );
          const projectPackExperiences = Object.fromEntries(
            experienceEntries.filter((entry): entry is readonly [ProjectPackDefinition["packId"], ProjectPackExperienceResponse] => entry !== null)
          );

          const approvals = sortLatestFirst(approvalsResponse.approvals);
          const auditEvents = auditResponse.events;
          const executionIds = Array.from(
            new Set([
              ...get().trackedExecutionIds,
              ...approvals.flatMap((approval) => (approval.executionId ? [approval.executionId] : [])),
              ...auditEvents.flatMap((event) =>
                typeof event.details.executionId === "string" ? [event.details.executionId] : []
              )
            ])
          );

          const executions = (
            await Promise.all(
              executionIds.map(async (executionId) => {
                try {
                  return await pilotApi.getExecution(clinicianToken ?? securityToken!, executionId);
                } catch {
                  return null;
                }
              })
            )
          ).filter((item): item is ExecutionRecord => item !== null);

          set({
            approvals,
            auditEvents,
            executions: sortLatestFirst(executions),
            incidents: deriveIncidents(executions, approvals, auditEvents),
            projectPacks: projectPacks.packs,
            projectPackExperiences,
            ...(commercialProof ? { commercialProof } : {}),
            ...(commercialClaims ? { commercialClaims } : {}),
            ...(commercialReadiness ? { commercialReadiness } : {}),
            ...(previewResponse ? { modelPreview: previewResponse } : {}),
            ...(policySnapshot ? { policySnapshot } : {}),
            trackedExecutionIds: executionIds,
            lastSyncedAt: toIso()
          });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "sync_failed" });
        } finally {
          set({ isSyncing: false });
        }
      },
      runWorkflow: async (mode, requestFollowupEmail = true) => {
        const token = get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "clinician_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const execution = await pilotApi.runExecution(token, mode, requestFollowupEmail);
          set((state) => ({
            trackedExecutionIds: Array.from(new Set([execution.executionId, ...state.trackedExecutionIds])),
            executions: sortLatestFirst([execution, ...state.executions.filter((item) => item.executionId !== execution.executionId)])
          }));
          await get().refreshWorkspace();
          return execution;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "execution_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      runProjectPack: async (packId, mode, options) => {
        const token = get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "clinician_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const response = await pilotApi.runProjectPack(token, packId, {
            mode,
            requestFollowupEmail: options?.requestFollowupEmail ?? true,
            ...(options?.classification ? { classification: options.classification } : {}),
            ...(typeof options?.zeroRetentionRequested === "boolean"
              ? { zeroRetentionRequested: options.zeroRetentionRequested }
              : {})
          });
          const execution = response.execution;
          set((state) => ({
            trackedExecutionIds: Array.from(new Set([execution.executionId, ...state.trackedExecutionIds])),
            executions: sortLatestFirst([execution, ...state.executions.filter((item) => item.executionId !== execution.executionId)])
          }));
          await get().refreshWorkspace();
          return execution;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "project_pack_execution_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      loadProjectPackExperience: async (packId) => {
        const token = getPrimaryToken(get());
        if (!token) {
          set({ error: "setup_required_connect_identities" });
          return null;
        }
        try {
          const experience = await pilotApi.getProjectPackExperience(token, packId);
          set((state) => ({
            projectPackExperiences: {
              ...state.projectPackExperiences,
              [packId]: experience
            }
          }));
          return experience;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "project_pack_experience_failed" });
          return null;
        }
      },
      applyProjectPackPolicyPreset: async (packId) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }
        set({ isSyncing: true, error: undefined });
        try {
          const response = await pilotApi.applyProjectPackPolicyPreset(token, packId);
          const snapshot: PolicyProfileSnapshot = {
            profile: response.result.profile,
            validation: response.result.validation
          };
          set({ policySnapshot: snapshot });
          await get().refreshWorkspace();
          return snapshot;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "project_pack_policy_apply_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      decideApproval: async (approvalId, decision, reason) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const approval = await pilotApi.decideApproval(token, approvalId, decision, reason);
          await get().refreshWorkspace();
          return approval;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "approval_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      previewPolicy: async (controls, profileName) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const snapshot = await pilotApi.previewPolicyProfile(token, { controls, ...(profileName ? { profileName } : {}) });
          set({ policySnapshot: snapshot });
          return snapshot;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "policy_preview_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      reviewPolicyWithCopilot: async (controls, operatorGoal, profileName) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const review = await pilotApi.reviewPolicyWithCopilot(token, {
            controls,
            operatorGoal,
            ...(profileName ? { profileName } : {})
          });
          set({ policyCopilot: review });
          return review;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "policy_copilot_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      explainPolicy: async (controls, operatorGoal, profileName) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const review = await pilotApi.explainPolicyProfile(token, {
            controls,
            ...(operatorGoal ? { operatorGoal } : {}),
            ...(profileName ? { profileName } : {})
          });
          set({ policyImpactReview: review, policySnapshot: review.proposed });
          return review;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "policy_explain_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      savePolicy: async (payload) => {
        const token = get().securitySession?.accessToken ?? get().clinicianSession?.accessToken;
        if (!token) {
          set({ error: "security_session_required" });
          return null;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const result = await pilotApi.savePolicyProfile(token, payload);
          const snapshot: PolicyProfileSnapshot = {
            profile: result.profile,
            validation: result.validation
          };
          set({ policySnapshot: snapshot });
          await get().refreshWorkspace();
          return snapshot;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "policy_save_failed" });
          return null;
        } finally {
          set({ isSyncing: false });
        }
      },
      boot: async () => {
        const state = get();
        if (state.isBootstrapping) return;
        set({ isBootstrapping: true });
        try {
          if (state.clinicianSession || state.securitySession) {
            await get().refreshWorkspace();
          } else if (isDemoIdentitiesEnabled()) {
            await get().connectDemoUsers();
          }
        } finally {
          set({ isBootstrapping: false });
        }
      }
    }),
    {
      name: storageKey,
      storage: createJSONStorage(() => createWorkspaceStorage()),
      version: 2,
      partialize: (state: PilotWorkspace) => workspacePersistSnapshot(state),
      migrate: (persistedState: unknown) => workspacePersistSnapshot(persistedState as PilotWorkspace)
    } as any
  )
);

export const pilotWorkspaceBlueprint = {
  personas: DEMO_PERSONAS,
  useCase: PILOT_USE_CASE,
  agents: AGENT_BLUEPRINTS,
  workflows: WORKFLOW_BLUEPRINTS,
  connectors: CONNECTOR_BLUEPRINTS,
  integrations: INTEGRATION_BLUEPRINTS,
  policies: POLICY_BLUEPRINTS,
  kpis: EXECUTIVE_KPIS
};

export const usePilotWorkspaceSelectors = {
  hasSessions: () =>
    usePilotWorkspace((state) => Boolean(state.clinicianSession || state.securitySession)),
  overview: () =>
    usePilotWorkspace((state) => ({
      clinicianSession: state.clinicianSession,
      securitySession: state.securitySession,
      activePersona: state.activePersona,
      isSyncing: state.isSyncing,
      error: state.error,
      lastSyncedAt: state.lastSyncedAt
    }))
};

