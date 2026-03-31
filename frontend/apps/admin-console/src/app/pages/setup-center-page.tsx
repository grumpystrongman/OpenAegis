import { useMemo } from "react";
import { Link } from "react-router-dom";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, KeyValueList, Panel, PageHeader } from "../ui.js";

const statusTone = (status: "done" | "pending" | "warning") =>
  status === "done" ? "success" : status === "warning" ? "warning" : "default";

export const SetupCenterPage = () => {
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const executions = usePilotWorkspace((state) => state.executions);
  const policySnapshot = usePilotWorkspace((state) => state.policySnapshot);
  const integrations = usePilotWorkspace((state) => state.integrations);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const runWorkflow = usePilotWorkspace((state) => state.runWorkflow);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const sessionsConnected = Boolean(clinicianSession && securitySession);

  const readiness = useMemo(() => {
    const simulationRan = executions.some((execution) => execution.mode === "simulation");
    const blockingIssues = policySnapshot?.validation.issues.filter((issue) => issue.severity === "blocking").length ?? 0;
    const policySafe = Boolean(policySnapshot?.validation.valid && blockingIssues === 0);
    const integrationsConfigured = integrations.filter((item) => item.status === "verified").length;

    return [
      {
        id: "sessions",
        title: "Connect evaluator identities",
        detail: "Creates clinician and security identities so every page can load live data safely.",
        route: "/setup",
        status: sessionsConnected ? "done" : "pending"
      },
      {
        id: "policy",
        title: "Validate policy baseline",
        detail: policySafe
          ? "Policy baseline is safe (no blocking issues)."
          : "Policy baseline needs remediation in Security Console before sign-off.",
        route: "/security",
        status: policySafe ? "done" : "warning"
      },
      {
        id: "simulation",
        title: "Run one simulation",
        detail: "Generates real execution, evidence, and graph artifacts for walkthroughs.",
        route: "/simulation",
        status: simulationRan ? "done" : sessionsConnected ? "pending" : "warning"
      },
      {
        id: "integration",
        title: "Verify at least one integration",
        detail: "Completes Databricks/Fabric/Snowflake/AWS setup with verification state.",
        route: "/integrations",
        status: integrationsConfigured > 0 ? "done" : "pending"
      }
    ] as const;
  }, [clinicianSession, executions, integrations, policySnapshot, securitySession]);

  const completed = readiness.filter((item) => item.status === "done").length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="First-run workflow"
        title="Setup Center"
        subtitle="One clean onboarding path. Follow these steps in order, then use the rest of the platform."
        actions={
          <>
            <Badge tone="info">Progress {completed}/4</Badge>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {clinicianSession && securitySession ? "Reconnect identities" : "Connect identities"}
            </button>
            <button type="button" onClick={() => void refreshWorkspace()} disabled={isSyncing}>
              Refresh status
            </button>
          </>
        }
      />

      <section className="split-grid">
        <Panel title="Quick start" subtitle="Recommended for executive demos and evaluator trials." tone="info">
          <ol className="plain-steps">
            {readiness.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>: {item.detail}
              </li>
            ))}
          </ol>
          <div className="pill-row">
            <button
              type="button"
              onClick={() => void runWorkflow("simulation")}
              disabled={!clinicianSession || isSyncing}
            >
              Run sample simulation
            </button>
            <button type="button" className="success" onClick={() => void runWorkflow("live")} disabled={!clinicianSession || isSyncing}>
              Run live workflow
            </button>
          </div>
        </Panel>

        <Panel title="Readiness checks" subtitle="Every item maps to a visible page and verifiable artifact.">
          <div className="stack">
            {readiness.map((item) => (
              <article key={item.id} className="policy-impact-row">
                <div className="policy-impact-head">
                  <strong>{item.title}</strong>
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                </div>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="What this pilot proves" subtitle="The platform claims this setup is measurable and replayable.">
          <KeyValueList
            items={[
              { label: "Use case", value: pilotWorkspaceBlueprint.useCase.title },
              { label: "Tenant", value: pilotWorkspaceBlueprint.useCase.tenantId },
              { label: "Workflow", value: pilotWorkspaceBlueprint.useCase.workflowId },
              { label: "Data class", value: pilotWorkspaceBlueprint.useCase.classification },
              {
                label: "Outcome",
                value: "Live mode is blocked until approval, then resumes with full audit evidence."
              }
            ]}
          />
        </Panel>

        <Panel title="Where to go next" subtitle="After setup, use these pages in sequence for a clean demo story.">
          <div className="stack">
            {[
              {
                title: "Integration Hub",
                summary: "Configure and verify Databricks, Fabric, Snowflake, or AWS.",
                to: "/integrations",
                status: readiness.find((item) => item.id === "integration")?.status ?? "pending"
              },
              {
                title: "Identity & Access",
                summary: "Define users, role access, and assurance levels.",
                to: "/identity",
                status: sessionsConnected ? "pending" : "warning"
              },
              {
                title: "Security Console",
                summary: "Preview policy impact and apply controlled changes.",
                to: "/security",
                status: readiness.find((item) => item.id === "policy")?.status ?? "warning"
              },
              {
                title: "Simulation Lab",
                summary: "Run simulation first, then live with approvals.",
                to: "/simulation",
                status: readiness.find((item) => item.id === "simulation")?.status ?? "pending"
              },
              {
                title: "Audit Explorer",
                summary: "Review evidence chain and final disposition.",
                to: "/audit",
                status: executions.length > 0 ? "done" : "pending"
              }
            ].map((item) => (
              <article key={item.to} className="policy-impact-row">
                <div className="policy-impact-head">
                  <strong>{item.title}</strong>
                  <Badge tone={statusTone(item.status as "done" | "pending" | "warning")}>{item.status}</Badge>
                </div>
                <p>{item.summary}</p>
                <Link className="subtle-link" to={item.to}>
                  Open {item.title}
                </Link>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
};
