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
  type PolicyProfileSnapshot
} from "../shared/api/pilot.js";
import { DEMO_PERSONAS, PILOT_USE_CASE, AGENT_BLUEPRINTS, CONNECTOR_BLUEPRINTS, EXECUTIVE_KPIS, POLICY_BLUEPRINTS, WORKFLOW_BLUEPRINTS } from "./pilot-data.js";

type PersonaKey = "clinician" | "security";
type Decision = "approve" | "reject";

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
  policySnapshot?: PolicyProfileSnapshot;
  policyCopilot?: PolicyCopilotReview;
  modelPreview?: { selected: ModelRoutePreview; fallback: ModelRoutePreview[] };
  lastSyncedAt?: string;
  isBootstrapping: boolean;
  isSyncing: boolean;
  error: string | undefined;
}

interface WorkspaceActions {
  connectDemoUsers: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  runWorkflow: (mode: "simulation" | "live", requestFollowupEmail?: boolean) => Promise<ExecutionRecord | null>;
  decideApproval: (approvalId: string, decision: Decision, reason: string) => Promise<ApprovalRecord | null>;
  previewPolicy: (controls: Partial<PolicyProfileControls>, profileName?: string) => Promise<PolicyProfileSnapshot | null>;
  reviewPolicyWithCopilot: (controls: Partial<PolicyProfileControls>, operatorGoal: string, profileName?: string) => Promise<PolicyCopilotReview | null>;
  savePolicy: (payload: {
    controls: Partial<PolicyProfileControls>;
    changeSummary: string;
    profileName?: string;
    breakGlass?: { ticketId: string; justification: string; approverIds: string[] };
  }) => Promise<PolicyProfileSnapshot | null>;
  setActivePersona: (persona: PersonaKey) => void;
  boot: () => Promise<void>;
}

export type PilotWorkspace = WorkspaceState & WorkspaceActions;

const storageKey = "openaegis.admin-console.workspace";

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

export const usePilotWorkspace = create<PilotWorkspace>()(
  persist(
    (set, get) => ({
      activePersona: "clinician",
      trackedExecutionIds: [],
      executions: [],
      approvals: [],
      auditEvents: [],
      incidents: [],
      isBootstrapping: false,
      isSyncing: false,
      error: undefined,
      setActivePersona: (persona) => set({ activePersona: persona }),
      connectDemoUsers: async () => {
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
            error: undefined
          });
          await get().refreshWorkspace();
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "login_failed" });
        } finally {
          set({ isSyncing: false });
        }
      },
      refreshWorkspace: async () => {
        const token = getPrimaryToken(get());
        if (!token) {
          set({ error: "connect_demo_users_to_load_live_data" });
          return;
        }

        set({ isSyncing: true, error: undefined });
        try {
          const [approvalsResponse, auditResponse, previewResponse, commercialProof, commercialClaims, commercialReadiness, policySnapshot] = await Promise.all([
            pilotApi.listApprovals(token),
            pilotApi.listAuditEvents(token),
            pilotApi.previewModelRoute(token),
            pilotApi.getCommercialProof(token),
            pilotApi.getCommercialClaims(token),
            pilotApi.getCommercialReadiness(token),
            pilotApi.getPolicyProfile(token)
          ]);

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
                  return await pilotApi.getExecution(token, executionId);
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
            commercialProof,
            commercialClaims,
            commercialReadiness,
            policySnapshot,
            modelPreview: previewResponse,
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
          }
        } finally {
          set({ isBootstrapping: false });
        }
      }
    }),
    {
      name: storageKey,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        clinicianSession: state.clinicianSession,
        securitySession: state.securitySession,
        activePersona: state.activePersona,
        trackedExecutionIds: state.trackedExecutionIds
      })
    }
  )
);

export const pilotWorkspaceBlueprint = {
  personas: DEMO_PERSONAS,
  useCase: PILOT_USE_CASE,
  agents: AGENT_BLUEPRINTS,
  workflows: WORKFLOW_BLUEPRINTS,
  connectors: CONNECTOR_BLUEPRINTS,
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

