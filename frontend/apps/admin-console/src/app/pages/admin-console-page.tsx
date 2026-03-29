import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, KeyValueList, Panel, PageHeader } from "../ui.js";

export const AdminConsolePage = () => {
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const approvals = usePilotWorkspace((state) => state.approvals);
  const executions = usePilotWorkspace((state) => state.executions);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Tenant administration"
        title="Admin Console"
        subtitle="Operational controls for the regulated hospital tenant, including session readiness and release posture."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {clinicianSession ? "Reconnect sessions" : "Connect sessions"}
            </button>
            <button type="button" onClick={() => void refreshWorkspace()} disabled={!clinicianSession || isSyncing}>
              Refresh workspace
            </button>
          </>
        }
      />

      <section className="split-grid">
        <Panel title="Tenant profile" subtitle="The current pilot is scoped to one tenant with explicit identity boundaries.">
          <KeyValueList
            items={[
              { label: "Tenant", value: pilotWorkspaceBlueprint.useCase.tenantId },
              { label: "Region", value: "us-east-1" },
              { label: "Environment", value: "pilot-regulated" },
              { label: "Runtime", value: "Kubernetes + hardened containers / microVM optional" },
              { label: "Storage", value: "Postgres metadata, Kafka events, object storage evidence" }
            ]}
          />
          <div className="pill-row">
            <Badge tone="success">BYOK enabled</Badge>
            <Badge tone="warning">Egress deny-by-default</Badge>
            <Badge tone="info">Tenant isolation strict</Badge>
          </div>
        </Panel>

        <Panel title="Session readiness" subtitle="The pilot needs authenticated clinician and security sessions to drive live data.">
          <div className="stack">
            <div className="session-card">
              <div>
                <strong>Clinician</strong>
                <p>{clinicianSession ? clinicianSession.user.email : "Not connected"}</p>
              </div>
              <Badge tone={clinicianSession ? "success" : "warning"}>{clinicianSession ? "connected" : "missing"}</Badge>
            </div>
            <div className="session-card">
              <div>
                <strong>Security reviewer</strong>
                <p>{securitySession ? securitySession.user.email : "Not connected"}</p>
              </div>
              <Badge tone={securitySession ? "success" : "warning"}>{securitySession ? "connected" : "missing"}</Badge>
            </div>
            <div className="session-card">
              <div>
                <strong>Live pilot state</strong>
                <p>{executions.length} executions and {approvals.length} approvals tracked through the pilot API.</p>
              </div>
              <Badge tone="info">Evidence-first</Badge>
            </div>
          </div>
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Release checklist" subtitle="Operational controls required before a commercial rollout.">
          <div className="checklist">
            <label><input type="checkbox" readOnly checked /> Signed build artifacts and SBOM generation</label>
            <label><input type="checkbox" readOnly checked /> Policy regression tests and runtime smoke tests</label>
            <label><input type="checkbox" readOnly checked /> Immutable audit ledger and replay validation</label>
            <label><input type="checkbox" readOnly checked /> Connector trust tier review and outbound allowlist</label>
            <label><input type="checkbox" readOnly checked /> Step-up MFA for approvals and incident review</label>
          </div>
        </Panel>

        <Panel title="Infrastructure posture" subtitle="The system is designed to stay vendor-neutral and portable.">
          <KeyValueList
            items={[
              { label: "Workflow engine", value: "Deterministic orchestration with replay checkpoints" },
              { label: "Policy engine", value: "OPA/Cedar-style enforcement outside the model" },
              { label: "Model routing", value: "Provider-neutral allow/deny and zero-retention flags" },
              { label: "Secrets", value: "Short-lived leasing through a broker" },
              { label: "Incident review", value: "Derived from blocked executions, rejected approvals, and audit events" }
            ]}
          />
        </Panel>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Service inventory</h3>
            <p className="panel-subtitle">Pilot services and the control points they enforce.</p>
          </div>
        </div>
        <div className="service-grid">
          {pilotWorkspaceBlueprint.agents.map((agent) => (
            <article key={agent.agentId} className="service-card">
              <div className="service-top">
                <strong>{agent.name}</strong>
                <Badge tone="info">{agent.sandboxProfile}</Badge>
              </div>
              <p>{agent.purpose}</p>
              <div className="service-meta">
                <span>{agent.owner}</span>
                <span>{agent.budget.stepLimit} steps</span>
                <span>{agent.budget.maxRuntimeSeconds}s runtime</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};

