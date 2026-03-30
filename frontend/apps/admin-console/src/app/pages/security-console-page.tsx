import { useEffect, useMemo, useState } from "react";
import type { PolicyProfileControls } from "../../shared/api/pilot.js";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, JsonBlock, KeyValueList, Panel, PageHeader } from "../ui.js";

const defaultControls: PolicyProfileControls = {
  enforceSecretDeny: true,
  requireZeroRetentionForPhi: true,
  requireApprovalForHighRiskLive: true,
  requireDlpOnOutbound: true,
  restrictExternalProvidersToZeroRetention: true,
  maxToolCallsPerExecution: 8
};

const CONTROL_COPY: Array<{
  key: keyof PolicyProfileControls;
  label: string;
  why: string;
  warning: string;
}> = [
  {
    key: "enforceSecretDeny",
    label: "Always block SECRET data requests",
    why: "Keeps the highest-risk data from leaving secure boundaries.",
    warning: "Turning this off can expose highly sensitive data."
  },
  {
    key: "requireZeroRetentionForPhi",
    label: "Require zero-retention for PHI/EPHI model calls",
    why: "Prevents external providers from retaining patient data.",
    warning: "Turning this off can violate hospital privacy requirements."
  },
  {
    key: "requireApprovalForHighRiskLive",
    label: "Require human approval for high-risk live actions",
    why: "Stops risky live actions until a person confirms them.",
    warning: "Turning this off can trigger unsafe actions automatically."
  },
  {
    key: "requireDlpOnOutbound",
    label: "Run DLP scan before outbound output",
    why: "Redacts sensitive information before sending it out.",
    warning: "Turning this off increases accidental data leak risk."
  },
  {
    key: "restrictExternalProvidersToZeroRetention",
    label: "Route PHI/EPHI only to zero-retention providers",
    why: "Forces safer model routes for regulated workloads.",
    warning: "Turning this off can route sensitive data to higher-risk providers."
  }
];

const issueTone = (severity: "blocking" | "warning" | "info") =>
  severity === "blocking" ? "danger" : severity === "warning" ? "warning" : "info";

export const SecurityConsolePage = () => {
  const modelPreview = usePilotWorkspace((state) => state.modelPreview);
  const policySnapshot = usePilotWorkspace((state) => state.policySnapshot);
  const policyCopilot = usePilotWorkspace((state) => state.policyCopilot);
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const approvals = usePilotWorkspace((state) => state.approvals);
  const incidents = usePilotWorkspace((state) => state.incidents);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const previewPolicy = usePilotWorkspace((state) => state.previewPolicy);
  const reviewPolicyWithCopilot = usePilotWorkspace((state) => state.reviewPolicyWithCopilot);
  const savePolicy = usePilotWorkspace((state) => state.savePolicy);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const securitySession = usePilotWorkspace((state) => state.securitySession);

  const [profileName, setProfileName] = useState("Hospital Safe Baseline");
  const [changeSummary, setChangeSummary] = useState("Update policy controls from Security Console.");
  const [operatorGoal, setOperatorGoal] = useState("Keep patient data safe and reduce false alarms.");
  const [ticketId, setTicketId] = useState("");
  const [justification, setJustification] = useState("");
  const [approverIds, setApproverIds] = useState("security-lead-1, compliance-lead-2");
  const [draftControls, setDraftControls] = useState<PolicyProfileControls>(defaultControls);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!policySnapshot) return;
    setDraftControls(policySnapshot.profile.controls);
    setProfileName(policySnapshot.profile.profileName);
  }, [policySnapshot]);

  const blockedEvents = useMemo(() => auditEvents.filter((event) => event.status === "blocked"), [auditEvents]);
  const issues = policySnapshot?.validation.issues ?? [];
  const blockingIssues = issues.filter((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const simulation = policySnapshot?.validation.simulation;

  const runPreview = async () => {
    setNotice(null);
    const snapshot = await previewPolicy(draftControls, profileName);
    if (snapshot) setNotice("Preview refreshed. Review warnings before applying.");
  };

  const runCopilot = async () => {
    setNotice(null);
    const review = await reviewPolicyWithCopilot(draftControls, operatorGoal, profileName);
    if (review) {
      setNotice(`Copilot review complete (${review.source}).`);
    }
  };

  const applyCopilotSuggestion = () => {
    if (!policyCopilot) return;
    setDraftControls(policyCopilot.suggestedControls);
    setChangeSummary(policyCopilot.suggestedReason);
    setNotice("Copilot recommendation applied to the editor. Run preview before saving.");
  };

  const applyPolicy = async () => {
    setNotice(null);
    const breakGlass = blockingIssues.length
      ? {
          ticketId,
          justification,
          approverIds: approverIds
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        }
      : undefined;

    const result = await savePolicy({
      controls: draftControls,
      changeSummary,
      profileName,
      ...(breakGlass ? { breakGlass } : {})
    });
    if (result) {
      setNotice("Policy profile saved. Refreshing live policy and model routing view.");
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Trust plane"
        title="Security Console"
        subtitle="Beginner-safe policy controls with impact preview, human-readable warnings, and copilot guidance."
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

      {notice ? <div className="banner info">{notice}</div> : null}

      <section className="split-grid">
        <Panel title="How to change policy safely" subtitle="Three-step flow: edit, preview impact, then apply.">
          <ol className="plain-steps">
            <li>Change one setting at a time and read the plain-language warning next to it.</li>
            <li>Click Preview Impact to see what decisions would change.</li>
            <li>Apply only when there are no blocking issues, or add break-glass evidence if required.</li>
          </ol>
          <div className="pill-row">
            <Badge tone="success">Policies enforced outside model</Badge>
            <Badge tone="warning">Impact preview required</Badge>
            <Badge tone="danger">Break-glass needs dual approval</Badge>
          </div>
        </Panel>

        <Panel title="Model route decision" subtitle="The broker follows policy profile constraints for sensitive data.">
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
            </>
          ) : (
            <p className="muted">Connect a demo session to inspect provider routing.</p>
          )}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel
          title="Policy Studio"
          subtitle="Designed so non-experts can configure safely with clear guardrails."
          actions={
            <div className="panel-actions">
              <button type="button" onClick={() => void runPreview()} disabled={isSyncing}>
                Preview impact
              </button>
              <button type="button" onClick={() => void runCopilot()} disabled={isSyncing}>
                Ask copilot
              </button>
              <button type="button" className="primary" onClick={() => void applyPolicy()} disabled={isSyncing}>
                Apply policy
              </button>
            </div>
          }
        >
          <div className="policy-editor-grid">
            <label className="form-field">
              <span>Policy profile name</span>
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            </label>
            <label className="form-field">
              <span>Change summary (what changed and why)</span>
              <input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} />
            </label>
          </div>

          <div className="policy-control-list">
            {CONTROL_COPY.map((control) => (
              <label key={control.key} className="policy-toggle">
                <div>
                  <strong>{control.label}</strong>
                  <p>{control.why}</p>
                  <p className="warning-copy">{control.warning}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draftControls[control.key] as boolean}
                  onChange={(event) =>
                    setDraftControls((previous) => ({ ...previous, [control.key]: event.target.checked }))
                  }
                />
              </label>
            ))}
          </div>

          <label className="form-field compact">
            <span>Max tool calls per execution</span>
            <input
              type="number"
              min={3}
              max={20}
              value={draftControls.maxToolCallsPerExecution}
              onChange={(event) =>
                setDraftControls((previous) => ({
                  ...previous,
                  maxToolCallsPerExecution: Number(event.target.value)
                }))
              }
            />
            <small>Recommended: 6-12 for regulated environments.</small>
          </label>

          <label className="form-field compact">
            <span>Copilot goal (plain language)</span>
            <textarea value={operatorGoal} onChange={(event) => setOperatorGoal(event.target.value)} />
          </label>

          {blockingIssues.length > 0 ? (
            <div className="breakglass-panel">
              <strong>Break-glass details required (blocking issues detected)</strong>
              <label className="form-field compact">
                <span>Ticket ID</span>
                <input value={ticketId} onChange={(event) => setTicketId(event.target.value)} />
              </label>
              <label className="form-field compact">
                <span>Justification (at least 20 characters)</span>
                <textarea value={justification} onChange={(event) => setJustification(event.target.value)} />
              </label>
              <label className="form-field compact">
                <span>Dual approver IDs (comma-separated)</span>
                <input value={approverIds} onChange={(event) => setApproverIds(event.target.value)} />
              </label>
            </div>
          ) : null}
        </Panel>

        <Panel title="Impact and warnings" subtitle="Every change is scored before it is applied.">
          <KeyValueList
            items={[
              { label: "Profile version", value: policySnapshot?.profile.profileVersion ?? "n/a" },
              { label: "Blocking issues", value: blockingIssues.length },
              { label: "Warnings", value: warnings.length },
              {
                label: "Decision mix",
                value: simulation
                  ? `Allow ${simulation.totals.allow}, Approval ${simulation.totals.requireApproval}, Deny ${simulation.totals.deny}`
                  : "Run preview to compute impact"
              }
            ]}
          />
          <div className="stack">
            {issues.length === 0 ? <p className="muted">No validation issues. This profile is ready to apply.</p> : null}
            {issues.map((issue) => (
              <article key={issue.code} className="policy-issue">
                <div className="policy-issue-head">
                  <strong>{issue.title}</strong>
                  <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
                </div>
                <p>{issue.message}</p>
                <div className="policy-foot">{issue.remediation}</div>
              </article>
            ))}
          </div>
          {simulation?.warnings.length ? (
            <div className="stack">
              {simulation.warnings.map((warning) => (
                <div key={warning} className="warning-row">
                  <Badge tone="warning">Impact</Badge>
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          ) : null}
          {simulation ? <JsonBlock value={simulation.scenarios} /> : null}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel
          title="LLM policy copilot"
          subtitle="Local model review explains risks and proposes safer settings."
          actions={
            policyCopilot ? (
              <button type="button" className="primary" onClick={applyCopilotSuggestion}>
                Apply copilot suggestion
              </button>
            ) : undefined
          }
        >
          {policyCopilot ? (
            <div className="stack">
              <KeyValueList
                items={[
                  { label: "Source", value: policyCopilot.source },
                  { label: "Confidence", value: policyCopilot.confidence.toFixed(2) },
                  { label: "Summary", value: policyCopilot.summary }
                ]}
              />
              <p>{policyCopilot.riskNarrative}</p>
              <div className="stack">
                {policyCopilot.hints.map((hint) => (
                  <div key={hint} className="hint-row">
                    <Badge tone="info">Hint</Badge>
                    <span>{hint}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">Ask copilot to get plain-language review and safe fix suggestions.</p>
          )}
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
