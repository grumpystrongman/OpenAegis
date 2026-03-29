import { useState } from "react";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, EmptyState, KeyValueList, Panel, PageHeader } from "../ui.js";

const scenarios = [
  {
    key: "happy-path",
    title: "Simulation only",
    description: "Runs the discharge workflow without a live approval gate."
  },
  {
    key: "live-approved",
    title: "Live with approval",
    description: "Triggers an approval request before outbound communication."
  },
  {
    key: "high-risk-email",
    title: "High-risk outbound email",
    description: "Same workflow, but explicitly emphasizes the human gate."
  }
] as const;

export const SimulationLabPage = () => {
  const [scenario, setScenario] = useState<(typeof scenarios)[number]["key"]>("happy-path");
  const [requestFollowupEmail, setRequestFollowupEmail] = useState(true);
  const executions = usePilotWorkspace((state) => state.executions);
  const modelPreview = usePilotWorkspace((state) => state.modelPreview);
  const runWorkflow = usePilotWorkspace((state) => state.runWorkflow);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);

  const latestExecution = executions[0];
  const selectedScenario = scenarios.find((item) => item.key === scenario) ?? scenarios[0];
  const latestOutput = latestExecution?.output ?? {
    summary: "No execution snapshot is available yet.",
    recommendation: "Connect sessions and run the workflow to populate this view.",
    riskFlags: [] as string[]
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Practice mode"
        title="Simulation Lab"
        subtitle="Test the discharge workflow in simulation first, then run the same orchestration live with policy enforcement."
        actions={<Badge tone="warning">Safe by default</Badge>}
      />

      <section className="split-grid">
        <Panel title="Scenario picker" subtitle="Pick the operating mode before running the workflow.">
          <div className="scenario-list">
            {scenarios.map((item) => (
              <button
                key={item.key}
                type="button"
                className={scenario === item.key ? "scenario-card active" : "scenario-card"}
                onClick={() => setScenario(item.key)}
              >
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </button>
            ))}
          </div>
          <div className="toggle-row">
            <label>
              <input
                type="checkbox"
                checked={requestFollowupEmail}
                onChange={(event) => setRequestFollowupEmail(event.target.checked)}
              />
              Request follow-up email
            </label>
          </div>
          <div className="pill-row">
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {clinicianSession ? "Reconnect demo sessions" : "Connect demo sessions"}
            </button>
            <button
              type="button"
              onClick={() => void runWorkflow("simulation", requestFollowupEmail)}
              disabled={!clinicianSession || isSyncing}
            >
              Run simulation
            </button>
            <button
              type="button"
              className="success"
              onClick={() => void runWorkflow("live", requestFollowupEmail)}
              disabled={!clinicianSession || isSyncing}
            >
              Run live
            </button>
          </div>
        </Panel>

        <Panel title="Expected control path" subtitle="The same workflow changes behavior when policy requires approval.">
          <KeyValueList
            items={[
              { label: "Selected scenario", value: selectedScenario.title },
              { label: "Follow-up email", value: requestFollowupEmail ? "enabled" : "disabled" },
              { label: "Mode behavior", value: selectedScenario.key === "happy-path" ? "Simulation should complete" : "Live should gate on approval" },
              { label: "Route preview loaded", value: modelPreview ? "yes" : "no" }
            ]}
          />
          <div className="execution-summary">
            <strong>What the pilot demonstrates</strong>
            <p>
              A clinician can run the same workflow in simulation, then rerun it live and watch the platform stop at the
              approval gate before outbound communication.
            </p>
          </div>
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Latest run" subtitle="The most recent execution snapshot is the artifact you replay in demos.">
          {latestExecution ? (
            <>
              <div className="pill-row">
                <Badge tone={latestExecution.status === "blocked" ? "warning" : "success"}>{latestExecution.status}</Badge>
                <Badge tone="info">{latestExecution.mode}</Badge>
                <Badge tone="default">{latestExecution.currentStep}</Badge>
              </div>
              <KeyValueList
                items={[
                  { label: "Execution ID", value: latestExecution.executionId },
                  { label: "Patient", value: latestExecution.patientId },
                  { label: "Approval", value: latestExecution.approvalId ?? "none" },
                  { label: "Evidence", value: latestExecution.evidenceId }
                ]}
              />
              <div className="execution-summary">
                <strong>{latestOutput.summary}</strong>
                <p>{latestOutput.recommendation}</p>
              </div>
            </>
          ) : (
            <EmptyState
              title="No runs yet"
              description="Connect a demo session and run the simulation to populate the lab."
              action={
                <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                  Connect demo sessions
                </button>
              }
            />
          )}
        </Panel>

        <Panel title="Route detail" subtitle="Zero-retention provider choice and fallback chain shown from the live broker.">
          {modelPreview ? (
            <div className="route-preview">
              <div className="route-card">
                <div className="route-label">Selected</div>
                <strong>{modelPreview.selected.provider}</strong>
                <div className="route-note">{modelPreview.selected.modelId}</div>
                <div className="route-note">Zero-retention {modelPreview.selected.zeroRetention ? "on" : "off"}</div>
              </div>
              <div className="route-card subdued">
                <div className="route-label">Fallback</div>
                {modelPreview.fallback.map((fallback) => (
                  <div key={`${fallback.provider}-${fallback.modelId}`} className="fallback-row">
                    <strong>{fallback.provider}</strong>
                    <span>{fallback.modelId}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">Connect sessions to inspect the broker route.</p>
          )}
        </Panel>
      </section>
    </div>
  );
};
