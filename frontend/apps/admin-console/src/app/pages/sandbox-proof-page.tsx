import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { isDemoIdentitiesEnabled } from "../security-guards.js";
import { Badge, EmptyState, KeyValueList, MetricTile, Panel, PageHeader } from "../ui.js";
import { pilotApi, type SandboxProofPack, type SandboxProofReport } from "../../shared/api/pilot.js";

const decisionTone = (decision: "ALLOW" | "REQUIRE_APPROVAL" | "DENY") => {
  if (decision === "ALLOW") return "success" as const;
  if (decision === "REQUIRE_APPROVAL") return "warning" as const;
  return "danger" as const;
};

const sandboxTone = (sandboxClass: SandboxProofPack["connectorProof"][number]["sandboxClass"]) => {
  if (sandboxClass === "read-only") return "info" as const;
  if (sandboxClass === "approval-gated") return "warning" as const;
  return "success" as const;
};

const getProofReportStatus = (report: SandboxProofReport | undefined) => {
  if (!report || typeof report.report !== "object" || report.report === null) return undefined;
  const summary = (report.report as Record<string, unknown>).summary;
  if (typeof summary !== "object" || summary === null) return undefined;
  const status = (summary as Record<string, unknown>).status;
  const score = (summary as Record<string, unknown>).scorePercent;
  return {
    status: typeof status === "string" ? status : "unknown",
    score: typeof score === "number" ? score : undefined
  };
};

export const SandboxProofPage = () => {
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const activePersona = usePilotWorkspace((state) => state.activePersona);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const demoIdentitiesEnabled = isDemoIdentitiesEnabled();
  const [report, setReport] = useState<SandboxProofReport>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const accessToken = useMemo(() => {
    if (activePersona === "security") {
      return securitySession?.accessToken ?? clinicianSession?.accessToken;
    }
    return clinicianSession?.accessToken ?? securitySession?.accessToken;
  }, [activePersona, clinicianSession, securitySession]);

  const loadReport = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setError("");
    try {
      setReport(await pilotApi.getSandboxProof(accessToken));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "request_failed");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void loadReport();
  }, [accessToken, loadReport]);

  const proofReportStatus = getProofReportStatus(report);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Proof surface"
        title="Sandbox Proof"
        subtitle="Per-pack connector and workflow proof pulled from the live API so evaluators can see the sandbox boundary instead of trusting a hidden claim."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void loadReport()} disabled={!accessToken || isLoading}>
              Refresh sandbox proof
            </button>
            <Badge tone="info">Live route: /v1/projects/sandbox-proof</Badge>
          </>
        }
      />

      {error ? <div className="banner error">Sandbox proof error: {error}</div> : null}

      {!accessToken ? (
        <Panel title="Connect a persona first" subtitle="This page reads the live sandbox proof endpoint and needs an authenticated session.">
          <EmptyState
            title="No active session"
            description="Connect the demo evaluator identities, then reload this page to render pack-by-pack proof."
            action={
              demoIdentitiesEnabled ? (
                <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                  Connect evaluator identities
                </button>
              ) : undefined
            }
          />
        </Panel>
      ) : report ? (
        <>
          <section className="metric-grid">
            <MetricTile
              label="Commercial packs"
              value={report.summary.totalPacks}
              detail="The five project-guide scenarios share the same visible sandbox proof surface."
              tone="info"
            />
            <MetricTile
              label="Connectors covered"
              value={report.summary.totalConnectors}
              detail="Each connector is listed with the sandbox class and the proof statement shown in the UI."
              tone="success"
            />
            <MetricTile
              label="Approval-gated packs"
              value={report.summary.approvalGatedPackCount}
              detail="Live paths that still require a human gate before the workflow can complete."
              tone={report.summary.approvalGatedPackCount > 0 ? "warning" : "default"}
            />
            <MetricTile
              label="Deny-path packs"
              value={report.summary.deniedScenarioCount}
              detail="Each pack keeps at least one explicit block path visible for evaluators."
              tone="danger"
            />
          </section>

          <section className="split-grid">
            <Panel title="How this page proves the sandbox" subtitle="These are the concrete artifacts the UI can point to while someone is evaluating the product.">
              <KeyValueList
                items={[
                  { label: "Generated at", value: new Date(report.generatedAt).toLocaleString() },
                  { label: "Evidence-backed packs", value: report.summary.evidenceBackedPackCount },
                  { label: "Commercial proof report", value: proofReportStatus ? `${proofReportStatus.status}${proofReportStatus.score !== undefined ? ` (${proofReportStatus.score}%)` : ""}` : "Not loaded" },
                  { label: "Next stop", value: <Link className="subtle-link" to="/projects">Project packs gallery</Link> }
                ]}
              />
            </Panel>

            <Panel title="Reproducible commands" subtitle="These repo-local commands back the screenshot flow and the broader commercial proof story.">
              <div className="stack">
                {report.commands.map((command) => (
                  <code key={command}>{command}</code>
                ))}
              </div>
            </Panel>
          </section>

          <section className="sandbox-pack-grid" aria-label="Sandbox proof by pack">
            {report.packs.map((packProof) => (
              <article key={packProof.pack.packId} className="sandbox-proof-pack">
                <div className="sandbox-pack-head">
                  <div>
                    <div className="eyebrow">Per-pack proof</div>
                    <h3>{packProof.pack.name}</h3>
                    <p>{packProof.workflowProof.summary}</p>
                  </div>
                  <div className="pill-row">
                    <Badge tone="info">{packProof.pack.industry}</Badge>
                    <Badge tone="warning">{packProof.pack.defaultClassification}</Badge>
                    <Badge tone="success">{packProof.pack.workflowId}</Badge>
                    <Link className="subtle-link" to={`/project-guide?pack=${packProof.pack.packId}`}>
                      Open guide
                    </Link>
                  </div>
                </div>

                <div className="sandbox-proof-columns">
                  <section className="sandbox-proof-section">
                    <div className="route-label">Connector proof</div>
                    <div className="stack">
                      {packProof.connectorProof.map((connector) => (
                        <article key={`${packProof.pack.packId}-${connector.toolId}`} className="sandbox-connector-row">
                          <div className="service-top">
                            <strong>{connector.toolId}</strong>
                            <div className="pill-row">
                              <Badge tone={sandboxTone(connector.sandboxClass)}>{connector.sandboxClass}</Badge>
                              <Badge tone="default">{connector.connectorType}</Badge>
                            </div>
                          </div>
                          <p>{connector.purpose}</p>
                          <p><strong>Scope:</strong> {connector.scope}</p>
                          <p><strong>Proof:</strong> {connector.proof}</p>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="sandbox-proof-section">
                    <div className="route-label">Workflow proof</div>
                    <div className="stack">
                      <article className="sandbox-workflow-card">
                        <div className="service-top">
                          <strong>Live path</strong>
                          <Badge tone={packProof.workflowProof.liveScenario ? decisionTone(packProof.workflowProof.liveScenario.expectedDecision) : "default"}>
                            {packProof.workflowProof.liveScenario?.expectedDecision ?? "n/a"}
                          </Badge>
                        </div>
                        <p>{packProof.workflowProof.liveScenario?.title ?? "No live scenario was returned."}</p>
                        <p><strong>Approval:</strong> {packProof.workflowProof.liveScenario?.humanApprovalRequired ? "Required" : "Not required"}</p>
                        <p><strong>Hint:</strong> {packProof.workflowProof.liveScenario?.operatorHint ?? "No operator hint returned."}</p>
                      </article>

                      <article className="sandbox-workflow-card">
                        <div className="service-top">
                          <strong>Deny path</strong>
                          <Badge tone={packProof.workflowProof.denyScenario ? decisionTone(packProof.workflowProof.denyScenario.expectedDecision) : "default"}>
                            {packProof.workflowProof.denyScenario?.expectedDecision ?? "n/a"}
                          </Badge>
                        </div>
                        <p>{packProof.workflowProof.denyScenario?.title ?? "No explicit deny scenario returned."}</p>
                        <p><strong>Hint:</strong> {packProof.workflowProof.denyScenario?.operatorHint ?? "No deny-path hint returned."}</p>
                      </article>

                      <article className="sandbox-workflow-card">
                        <div className="service-top">
                          <strong>Evidence counters</strong>
                          <Badge tone={packProof.workflowProof.evidence.auditEvents > 0 ? "success" : "default"}>
                            {packProof.workflowProof.evidence.auditEvents > 0 ? "Live evidence present" : "Waiting for first run"}
                          </Badge>
                        </div>
                        <div className="sandbox-evidence-grid">
                          <div><span>Executions</span><strong>{packProof.workflowProof.evidence.executions}</strong></div>
                          <div><span>Approvals</span><strong>{packProof.workflowProof.evidence.approvals}</strong></div>
                          <div><span>Incidents</span><strong>{packProof.workflowProof.evidence.incidents}</strong></div>
                          <div><span>Audit events</span><strong>{packProof.workflowProof.evidence.auditEvents}</strong></div>
                        </div>
                        <p><strong>Latest execution:</strong> {packProof.workflowProof.evidence.latestExecutionId ?? "No execution yet"}</p>
                        <p><strong>Latest evidence:</strong> {packProof.workflowProof.evidence.latestEvidenceId ?? "No evidence yet"}</p>
                      </article>
                    </div>
                  </section>
                </div>

                <div className="sandbox-proof-columns">
                  <section className="sandbox-proof-section">
                    <div className="route-label">Visible control steps</div>
                    <ol className="plain-steps">
                      {packProof.workflowProof.walkthrough.map((step) => (
                        <li key={`${packProof.pack.packId}-${step.step}`}>
                          <strong>{step.title}</strong>: {step.control}. Evidence: {step.evidenceProduced}
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="sandbox-proof-section">
                    <div className="route-label">Trust checks</div>
                    <div className="stack">
                      {packProof.workflowProof.trustChecks.map((check) => (
                        <div key={`${packProof.pack.packId}-${check}`} className="sandbox-trust-check">
                          <strong>Trust check</strong>
                          <p>{check}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : (
        <Panel title="Loading sandbox proof" subtitle="The page is waiting on the live API response.">
          <EmptyState
            title="Sandbox proof pending"
            description="Refresh once identities are connected if the proof surface does not appear automatically."
            action={
              <button type="button" className="primary" onClick={() => void loadReport()} disabled={isLoading}>
                Reload
              </button>
            }
          />
        </Panel>
      )}
    </div>
  );
};
