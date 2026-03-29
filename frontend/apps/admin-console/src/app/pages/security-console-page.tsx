import { useMemo } from "react";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, JsonBlock, KeyValueList, Panel, PageHeader } from "../ui.js";

export const SecurityConsolePage = () => {
  const modelPreview = usePilotWorkspace((state) => state.modelPreview);
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const approvals = usePilotWorkspace((state) => state.approvals);
  const incidents = usePilotWorkspace((state) => state.incidents);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const securitySession = usePilotWorkspace((state) => state.securitySession);

  const blockedEvents = useMemo(() => auditEvents.filter((event) => event.status === "blocked"), [auditEvents]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Trust plane"
        title="Security Console"
        subtitle="Policy routing, zero-retention model selection, and control-plane posture for regulated EPHI handling."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {securitySession ? "Reconnect sessions" : "Connect sessions"}
            </button>
            <button type="button" onClick={() => void refreshWorkspace()} disabled={!securitySession || isSyncing}>
              Refresh policy view
            </button>
          </>
        }
      />

      <section className="split-grid">
        <Panel title="Policy posture" subtitle="Policies are enforced outside the model and are never delegated to the model provider.">
          <KeyValueList
            items={[
              { label: "Egress", value: "Deny-by-default with signed connector manifests" },
              { label: "Retention", value: "Zero-retention required for external EPHI model calls" },
              { label: "Approvals", value: "High-risk live actions require human review" },
              { label: "Forensics", value: "Replayable evidence chain with immutable hashes" },
              { label: "Tenant isolation", value: "Identity-bound tenant context on every request" }
            ]}
          />
          <div className="pill-row">
            <Badge tone="success">Policy service active</Badge>
            <Badge tone="warning">Step-up MFA on sensitive surfaces</Badge>
            <Badge tone="danger">Break-glass requires dual approval</Badge>
          </div>
        </Panel>

        <Panel title="Model route decision" subtitle="The broker selects providers by capability, risk, and retention policy.">
          {modelPreview ? (
            <>
              <div className="route-preview compact">
                <div className="route-card">
                  <div className="route-label">Selected route</div>
                  <strong>{modelPreview.selected.provider}</strong>
                  <div className="route-note">{modelPreview.selected.modelId}</div>
                  <div className="route-note">
                    Zero-retention {modelPreview.selected.zeroRetention ? "enabled" : "disabled"}
                  </div>
                </div>
                <div className="route-card subdued">
                  <div className="route-label">Score</div>
                  {modelPreview.selected.score ? (
                    <KeyValueList
                      items={[
                        { label: "Cost", value: modelPreview.selected.score.cost.toFixed(2) },
                        { label: "Latency", value: `${modelPreview.selected.score.latency} ms` },
                        { label: "Risk", value: modelPreview.selected.score.risk.toFixed(2) },
                        { label: "Total", value: modelPreview.selected.score.total.toFixed(2) }
                      ]}
                    />
                  ) : (
                    <span>No score returned by the pilot backend.</span>
                  )}
                </div>
              </div>
              <JsonBlock value={modelPreview} />
            </>
          ) : (
            <p className="muted">Connect a demo session to inspect provider routing.</p>
          )}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Policy catalog" subtitle="Current security policies used by the pilot.">
          <div className="policy-list">
            {pilotWorkspaceBlueprint.policies.map((policy) => (
              <article key={policy.policyId} className="policy-card">
                <div className="policy-card-head">
                  <strong>{policy.name}</strong>
                  <Badge tone="info">{policy.scope}</Badge>
                </div>
                <p>{policy.enforcement}</p>
                <div className="policy-foot">{policy.defaultDecision}</div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Blocked signals" subtitle="Anything blocked is surfaced as a reviewable control-plane signal.">
          <KeyValueList
            items={[
              { label: "Blocked audit events", value: blockedEvents.length },
              { label: "Open incidents", value: incidents.filter((incident) => incident.status === "open").length },
              { label: "Contained incidents", value: incidents.filter((incident) => incident.status === "contained").length },
              { label: "Tracked approvals", value: approvals.length }
            ]}
          />
          <div className="stack">
            {blockedEvents.slice(0, 3).map((event) => (
              <article key={event.eventId} className="signal-row">
                <div>
                  <strong>{event.action}</strong>
                  <p>{event.category}</p>
                </div>
                <Badge tone="warning">{event.status}</Badge>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Connector trust tiers</h3>
            <p className="panel-subtitle">The pilot distinguishes trusted enterprise sources from higher-risk outbound channels.</p>
          </div>
        </div>
        <div className="connector-grid">
          {pilotWorkspaceBlueprint.connectors.map((connector) => (
            <article key={connector.name} className="connector-card">
              <div className="service-top">
                <strong>{connector.name}</strong>
                <Badge
                  tone={
                    connector.trustTier === "tier-1" ? "success" : connector.trustTier === "tier-2" ? "warning" : "danger"
                  }
                >
                  {connector.trustTier}
                </Badge>
              </div>
              <p>{connector.capability}</p>
              <div className="connector-foot">
                <span>{connector.defaultPermission}</span>
                <span>{connector.riskNotes}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
