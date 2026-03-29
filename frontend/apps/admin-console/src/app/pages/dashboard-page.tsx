import { useMemo } from "react";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, EmptyState, KeyValueList, MetricTile, Panel, PageHeader } from "../ui.js";

const formatTime = (value?: string) => (value ? new Date(value).toLocaleString() : "n/a");

export const DashboardPage = () => {
  const executions = usePilotWorkspace((state) => state.executions);
  const approvals = usePilotWorkspace((state) => state.approvals);
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const incidents = usePilotWorkspace((state) => state.incidents);
  const modelPreview = usePilotWorkspace((state) => state.modelPreview);
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const runWorkflow = usePilotWorkspace((state) => state.runWorkflow);

  const latestExecution = executions[0];
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const blockedExecutions = executions.filter((item) => item.status === "blocked");

  const metrics = useMemo(
    () => [
      { label: "Live executions", value: executions.length, detail: "Tracked via audit and execution lookup", tone: "info" as const },
      { label: "Blocked workflows", value: blockedExecutions.length, detail: "Waiting on human approval", tone: "warning" as const },
      { label: "Pending approvals", value: pendingApprovals.length, detail: "Sensitive actions in queue", tone: "danger" as const },
      { label: "Open incidents", value: incidents.filter((item) => item.status === "open").length, detail: "Derived from control-plane signals", tone: "success" as const }
    ],
    [blockedExecutions.length, executions.length, incidents, pendingApprovals.length]
  );
  const latestOutput = latestExecution?.output ?? {
    summary: "No execution has completed yet.",
    recommendation: "Run a simulation or connect the demo sessions to generate a runtime snapshot.",
    riskFlags: [] as string[]
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations overview"
        title="Business KPI Dashboard"
        subtitle="A live readout of the discharge assistant pilot, with approval state, audit coverage, and route posture."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {clinicianSession ? "Reconnect demo sessions" : "Connect demo sessions"}
            </button>
            <button type="button" onClick={() => void runWorkflow("simulation")} disabled={!clinicianSession || isSyncing}>
              Run simulation
            </button>
            <button type="button" className="success" onClick={() => void runWorkflow("live")} disabled={!clinicianSession || isSyncing}>
              Run live workflow
            </button>
          </>
        }
      />

      <section className="metric-grid">
        {metrics.map((metric) => (
          <MetricTile key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone} />
        ))}
      </section>

      <section className="split-grid">
        <Panel
          title="Pilot use case"
          subtitle="The shipped pilot is intentionally narrow and real: discharge summary generation for a single hospital tenant."
          tone="info"
        >
          <KeyValueList
            items={[
              { label: "Tenant", value: pilotWorkspaceBlueprint.useCase.tenantId },
              { label: "Workflow", value: pilotWorkspaceBlueprint.useCase.workflowId },
              { label: "Patient", value: pilotWorkspaceBlueprint.useCase.patientId },
              { label: "Classification", value: pilotWorkspaceBlueprint.useCase.classification },
              { label: "Expected outcome", value: pilotWorkspaceBlueprint.useCase.outcome }
            ]}
          />
          <div className="pill-row">
            <Badge tone="success">Replayable</Badge>
            <Badge tone="warning">Policy gated</Badge>
            <Badge tone="info">Zero-retention route</Badge>
          </div>
        </Panel>

        <Panel title="Route preview" subtitle="Model broker decision for the current tenant and data class.">
          {modelPreview ? (
            <div className="route-preview">
              <div className="route-card">
                <div className="route-label">Selected provider</div>
                <strong>{modelPreview.selected.provider}</strong>
                <div className="route-note">{modelPreview.selected.modelId}</div>
                <div className="route-note">Zero-retention: {modelPreview.selected.zeroRetention ? "enabled" : "disabled"}</div>
                <div className="pill-row">
                  {(modelPreview.selected.reasonCodes ?? ["route-selected-by-policy"]).map((reason) => (
                    <Badge key={reason} tone="info">
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="route-card subdued">
                <div className="route-label">Fallback chain</div>
                {modelPreview.fallback.length > 0 ? (
                  modelPreview.fallback.map((fallback) => (
                    <div key={`${fallback.provider}-${fallback.modelId}`} className="fallback-row">
                      <strong>{fallback.provider}</strong>
                      <span>{fallback.modelId}</span>
                    </div>
                  ))
                ) : (
                  <span>Policy prevented fallback routing.</span>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="Connect a demo session"
              description="The route preview comes from the live pilot API after authentication."
              action={
                <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                  Connect demo sessions
                </button>
              }
            />
          )}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Latest execution" subtitle="The most recent workflow run and its evidence trail.">
          {latestExecution ? (
            <div className="execution-detail">
              <div className="pill-row">
                <Badge tone={latestExecution.status === "blocked" ? "warning" : "success"}>{latestExecution.status}</Badge>
                <Badge tone="info">{latestExecution.mode}</Badge>
                <Badge tone="default">{latestExecution.workflowId}</Badge>
              </div>
              <KeyValueList
                items={[
                  { label: "Execution ID", value: latestExecution.executionId },
                  { label: "Current step", value: latestExecution.currentStep },
                  { label: "Approval ID", value: latestExecution.approvalId ?? "none" },
                  { label: "Evidence ID", value: latestExecution.evidenceId },
                  { label: "Updated", value: formatTime(latestExecution.updatedAt) }
                ]}
              />
              <div className="execution-summary">
                <strong>{latestOutput.summary}</strong>
                <p>{latestOutput.recommendation}</p>
                <div className="pill-row">
                  {latestOutput.riskFlags.map((flag) => (
                    <Badge key={flag} tone="danger">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No executions yet"
              description="Run the simulation once the demo sessions are connected."
              action={
                <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                  Connect demo sessions
                </button>
              }
            />
          )}
        </Panel>

        <Panel title="Approval posture" subtitle="Sensitive actions are blocked until a human reviewer approves them.">
          <KeyValueList
            items={[
              { label: "Pending approvals", value: pendingApprovals.length },
              { label: "Blocked executions", value: blockedExecutions.length },
              { label: "Open incidents", value: incidents.filter((item) => item.status === "open").length },
              { label: "Audit events", value: auditEvents.length }
            ]}
          />
          {pendingApprovals.length > 0 ? (
            <div className="approval-queue">
              {pendingApprovals.slice(0, 3).map((approval) => (
                <div key={approval.approvalId} className="queue-row">
                  <div>
                    <strong>{approval.approvalId}</strong>
                    <p>{approval.reason}</p>
                  </div>
                  <Badge tone={approval.riskLevel === "critical" ? "danger" : "warning"}>{approval.riskLevel}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No pending approvals" description="Simulation mode completes without review; live mode creates a queue entry." />
          )}
        </Panel>
      </section>
    </div>
  );
};
