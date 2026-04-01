import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { isDemoIdentitiesEnabled } from "../security-guards.js";
import { Badge, EmptyState, KeyValueList, Panel, PageHeader, Table } from "../ui.js";

const decisionTone = (effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY" | undefined) => {
  if (effect === "ALLOW") return "success";
  if (effect === "REQUIRE_APPROVAL") return "warning";
  if (effect === "DENY") return "danger";
  return "default";
};

export const ProjectPacksPage = () => {
  const projectPacks = usePilotWorkspace((state) => state.projectPacks);
  const projectPackExperiences = usePilotWorkspace((state) => state.projectPackExperiences);
  const executions = usePilotWorkspace((state) => state.executions);
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const runProjectPack = usePilotWorkspace((state) => state.runProjectPack);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const loadProjectPackExperience = usePilotWorkspace((state) => state.loadProjectPackExperience);
  const applyProjectPackPolicyPreset = usePilotWorkspace((state) => state.applyProjectPackPolicyPreset);
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [policyApplyMessage, setPolicyApplyMessage] = useState<string>("");
  const demoIdentitiesEnabled = isDemoIdentitiesEnabled();

  useEffect(() => {
    if (projectPacks.length === 0) return;
    if (!selectedPackId) {
      setSelectedPackId(projectPacks[0]!.packId);
      return;
    }
    if (!projectPacks.some((pack) => pack.packId === selectedPackId)) {
      setSelectedPackId(projectPacks[0]!.packId);
    }
  }, [projectPacks, selectedPackId]);

  const selectedPack = useMemo(
    () => projectPacks.find((pack) => pack.packId === selectedPackId) ?? projectPacks[0],
    [projectPacks, selectedPackId]
  );

  const selectedExperience = selectedPack ? projectPackExperiences[selectedPack.packId] : undefined;

  useEffect(() => {
    if (!selectedPack) return;
    if (projectPackExperiences[selectedPack.packId]) return;
    void loadProjectPackExperience(selectedPack.packId);
  }, [loadProjectPackExperience, projectPackExperiences, selectedPack]);

  useEffect(() => {
    if (!selectedExperience || selectedExperience.experience.dataTables.length === 0) {
      setSelectedTableId("");
      return;
    }
    if (!selectedTableId || !selectedExperience.experience.dataTables.some((table) => table.tableId === selectedTableId)) {
      setSelectedTableId(selectedExperience.experience.dataTables[0]!.tableId);
    }
  }, [selectedExperience, selectedTableId]);

  const selectedTable = useMemo(
    () =>
      selectedExperience?.experience.dataTables.find((table) => table.tableId === selectedTableId) ??
      selectedExperience?.experience.dataTables[0],
    [selectedExperience, selectedTableId]
  );

  const latestExecution = useMemo(
    () =>
      selectedPack
        ? executions.find((execution) => execution.workflowId === selectedPack.workflowId)
        : undefined,
    [executions, selectedPack]
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Commercial demo gallery"
        title="Commercial Project Packs"
        subtitle="Pick a scenario, inspect seeded tables, review policy outcomes, then run simulation and live mode to see OpenAegis control every risky step."
        actions={<Badge tone="info">{projectPacks.length} packs loaded</Badge>}
      />

      {projectPacks.length === 0 ? (
        <Panel title="Project packs unavailable" subtitle="Connect sessions and refresh to load the project catalog.">
          <EmptyState
            title="No project packs found"
            description="The API route `/v1/projects/packs` did not return a pack list yet."
            action={
              demoIdentitiesEnabled ? (
                <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                  Connect evaluator identities
                </button>
              ) : null
            }
          />
        </Panel>
      ) : null}

      {selectedPack ? (
        <>
          <Panel title="Start here" subtitle="Use the gallery to choose a pack, then open the guided walkthrough for the full setup, approvals, daily operations, and persona dashboards.">
            <div className="service-grid">
              <div className="guide-check-card">
                <strong>1. Pick the business scenario</strong>
                <p>Each pack is already seeded with data, policies, and trust checks so evaluators can start from a credible baseline.</p>
              </div>
              <div className="guide-check-card">
                <strong>2. Open the guided walkthrough</strong>
                <p>The walkthrough explains exactly what settings matter, which default is safest, and what changes will do before someone presses live.</p>
              </div>
              <div className="guide-check-card">
                <strong>3. Prove the controls</strong>
                <p>Run simulation first, trigger a live approval, and then inspect the audit and incident surfaces for the same pack.</p>
              </div>
            </div>
            <div className="guide-action-strip">
              <Link className="subtle-link" to={`/project-guide?pack=${selectedPack.packId}`}>
                Open {selectedPack.name} walkthrough
              </Link>
            </div>
          </Panel>

          <section className="split-grid">
            <Panel title="Pack selection" subtitle="Choose a real-world scenario to inspect and run.">
              <div className="scenario-list">
                {projectPacks.map((pack) => (
                  <button
                    key={pack.packId}
                    type="button"
                    className={pack.packId === selectedPack.packId ? "scenario-card active" : "scenario-card"}
                    onClick={() => {
                      setSelectedPackId(pack.packId);
                      setPolicyApplyMessage("");
                    }}
                  >
                    <strong>{pack.name}</strong>
                    <p>{pack.businessProblem}</p>
                    <div className="pill-row">
                      <Badge tone="info">{pack.industry}</Badge>
                      <Badge tone="default">{pack.persona}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Run + baseline" subtitle="Load identities, apply secure preset, then run simulation and live mode.">
              <div className="pill-row">
                <Badge tone="warning">{selectedPack.defaultClassification}</Badge>
                <Badge tone="info">{selectedPack.workflowId}</Badge>
                {selectedExperience ? (
                  <Badge tone="default">Policy profile v{selectedExperience.policyProfile.profileVersion}</Badge>
                ) : null}
              </div>
              <p className="muted">{selectedPack.expectedOutcome}</p>
              <div className="pill-row">
                {demoIdentitiesEnabled ? (
                  <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                    {clinicianSession ? "Reconnect evaluator identities" : "Connect evaluator identities"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="success"
                  onClick={() => void runProjectPack(selectedPack.packId, "simulation")}
                  disabled={!clinicianSession || isSyncing}
                >
                  Run simulation
                </button>
                <button
                  type="button"
                  className="success"
                  onClick={() => void runProjectPack(selectedPack.packId, "live")}
                  disabled={!clinicianSession || isSyncing}
                >
                  Run live
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void applyProjectPackPolicyPreset(selectedPack.packId).then((snapshot) => {
                      setPolicyApplyMessage(
                        snapshot
                          ? `Applied secure preset: ${snapshot.profile.profileName} (v${snapshot.profile.profileVersion})`
                          : "Policy preset application failed. Check role and tenant scope."
                      );
                    })
                  }
                  disabled={!securitySession || isSyncing}
                >
                  Apply secure preset
                </button>
                <Link className="subtle-link" to={`/project-guide?pack=${selectedPack.packId}`}>
                  Open full walkthrough
                </Link>
              </div>
              {policyApplyMessage ? <p className="muted">{policyApplyMessage}</p> : null}
              <p className="muted">Best evaluator flow: walkthrough first, simulation second, live run third, approval after that.</p>
              {latestExecution ? (
                <KeyValueList
                  items={[
                    { label: "Latest execution", value: latestExecution.executionId },
                    { label: "Status", value: latestExecution.status },
                    { label: "Mode", value: latestExecution.mode },
                    { label: "Evidence", value: latestExecution.evidenceId }
                  ]}
                />
              ) : (
                <p className="muted">No execution for this pack yet. Run simulation first.</p>
              )}
            </Panel>
          </section>

          <section className="split-grid">
            <Panel title="Seeded business data" subtitle="These rows are preloaded to show concrete operational context.">
              {!selectedExperience ? (
                <p className="muted">Loading pack experience...</p>
              ) : (
                <>
                  <div className="pill-row">
                    {selectedExperience.experience.dataTables.map((table) => (
                      <button
                        key={table.tableId}
                        type="button"
                        className={selectedTable?.tableId === table.tableId ? "primary" : ""}
                        onClick={() => setSelectedTableId(table.tableId)}
                      >
                        {table.title}
                      </button>
                    ))}
                  </div>
                  {selectedTable ? (
                    <>
                      <p className="muted">
                        {selectedTable.description} Source: <code>{selectedTable.source}</code>.
                      </p>
                      <div className="table-wrap">
                        <Table>
                          <thead>
                            <tr>
                              {selectedTable.columns.map((column) => (
                                <th key={`${selectedTable.tableId}-${column.key}`}>{column.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selectedTable.rows.map((row, rowIndex) => (
                              <tr key={`${selectedTable.tableId}-row-${rowIndex}`}>
                                {selectedTable.columns.map((column) => (
                                  <td key={`${selectedTable.tableId}-${rowIndex}-${column.key}`}>
                                    {String(row[column.key] ?? "")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                      <div className="pill-row">
                        <Badge tone="warning">{selectedTable.classification}</Badge>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </Panel>

            <Panel title="Policy outcomes (live)" subtitle="Scenario decisions are evaluated using the active policy profile.">
              {!selectedExperience ? (
                <p className="muted">Loading policy scenarios...</p>
              ) : (
                <>
                  <p className="muted">{selectedExperience.experience.plainLanguageSummary}</p>
                  <div className="stack">
                    {selectedExperience.experience.policyRules.map((rule) => (
                      <div key={rule.ruleId} className="policy-card">
                        <div className="policy-card-head">
                          <strong>{rule.title}</strong>
                          <Badge tone="warning">{rule.severity}</Badge>
                        </div>
                        <p>
                          <code>{rule.condition}</code> {"->"} <strong>{rule.effect}</strong>
                        </p>
                        <p>{rule.rationale}</p>
                      </div>
                    ))}
                  </div>
                  <div className="table-wrap">
                    <Table>
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Mode</th>
                          <th>Risk</th>
                          <th>Decision</th>
                          <th>Hint</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedExperience.experience.policyScenarios.map((scenario) => (
                          <tr key={scenario.scenarioId}>
                            <td>{scenario.title}</td>
                            <td>{scenario.input.mode}</td>
                            <td>{scenario.input.riskLevel}</td>
                            <td>
                              <Badge tone={decisionTone(scenario.decision?.effect)}>
                                {scenario.decision?.effect ?? "N/A"}
                              </Badge>
                            </td>
                            <td>{scenario.operatorHint}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <div className="stack">
                    {selectedExperience.experience.trustChecks.map((check, index) => (
                      <div key={`${selectedPack.packId}-trust-${index}`} className="service-card">
                        <strong>Trust check {index + 1}</strong>
                        <p>{check}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          </section>

          <section className="split-grid">
            <Panel title="Step-by-step walkthrough" subtitle="Follow these steps to demo this pack in under 10 minutes.">
              {!selectedExperience ? (
                <p className="muted">Loading walkthrough...</p>
              ) : (
                <div className="stack">
                  {selectedExperience.experience.walkthrough.map((step) => (
                    <div key={`${selectedPack.packId}-step-${step.step}`} className="workflow-step">
                      <div className="workflow-step-index">{step.step}</div>
                      <strong>{step.title}</strong>
                      <p>
                        <strong>Operator:</strong> {step.operatorAction}
                      </p>
                      <p>
                        <strong>OpenAegis control:</strong> {step.openAegisControl}
                      </p>
                      <p>
                        <strong>Evidence:</strong> {step.evidenceProduced}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Connector map and KPIs" subtitle="What this pack touches and what business outcomes it should drive.">
              <div className="stack">
                {selectedPack.connectors.map((connector) => (
                  <div key={`${selectedPack.packId}-${connector.toolId}`} className="connector-card">
                    <div className="service-top">
                      <strong>{connector.toolId}</strong>
                      <Badge tone="info">{connector.connectorType}</Badge>
                    </div>
                    <p>{connector.purpose}</p>
                  </div>
                ))}
              </div>
              <div className="stack">
                {selectedPack.kpis.map((kpi) => (
                  <div key={`${selectedPack.packId}-${kpi.id}`} className="service-card">
                    <div className="service-top">
                      <strong>{kpi.label}</strong>
                      <Badge tone="success">{kpi.target}</Badge>
                    </div>
                    <p>{kpi.whyItMatters}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
};
