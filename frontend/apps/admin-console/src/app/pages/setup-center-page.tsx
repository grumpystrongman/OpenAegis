import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  pilotApi,
  type SetupAssistantAction,
  type SetupAssistantResponse,
  type SetupAssistantStatus
} from "../../shared/api/pilot.js";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { isDemoIdentitiesEnabled } from "../security-guards.js";
import { Badge, KeyValueList, Panel, PageHeader } from "../ui.js";

const statusTone = (status: "done" | "pending" | "warning") =>
  status === "done" ? "success" : status === "warning" ? "warning" : "default";

const normalizeRoute = (route: string | undefined): string => {
  if (!route || route.trim().length === 0) return "/setup";
  return route.startsWith("/") ? route : `/${route}`;
};

export const SetupCenterPage = () => {
  const navigate = useNavigate();
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const executions = usePilotWorkspace((state) => state.executions);
  const policySnapshot = usePilotWorkspace((state) => state.policySnapshot);
  const integrations = usePilotWorkspace((state) => state.integrations);
  const projectPacks = usePilotWorkspace((state) => state.projectPacks);
  const commercialProof = usePilotWorkspace((state) => state.commercialProof);
  const commercialClaims = usePilotWorkspace((state) => state.commercialClaims);
  const initializePlatform = usePilotWorkspace((state) => state.initializePlatform);
  const runWorkflow = usePilotWorkspace((state) => state.runWorkflow);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const clearError = usePilotWorkspace((state) => state.clearError);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const sessionsConnected = Boolean(clinicianSession && securitySession);
  const demoIdentitiesEnabled = isDemoIdentitiesEnabled();

  const [assistantStatus, setAssistantStatus] = useState<SetupAssistantStatus | undefined>(undefined);
  const [assistantPrompt, setAssistantPrompt] = useState(
    "Set up this platform for a new evaluator with minimal effort."
  );
  const [assistantResponse, setAssistantResponse] = useState<SetupAssistantResponse | undefined>(undefined);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantApplyBusy, setAssistantApplyBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await pilotApi.getSetupAssistantStatus();
        if (active) setAssistantStatus(status);
      } catch (error) {
        if (active) {
          setAssistantError(error instanceof Error ? error.message : "assistant_status_failed");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const runAssistantActions = async (actions: SetupAssistantAction[]) => {
    if (actions.length === 0) return;
    setAssistantApplyBusy(true);
    setAssistantError(undefined);
    try {
      for (const action of actions) {
        if (action.type === "connect_demo_users") {
          await initializePlatform();
          continue;
        }
        if (action.type === "refresh_workspace") {
          await refreshWorkspace();
          continue;
        }
        if (action.type === "run_simulation") {
          await runWorkflow("simulation");
          continue;
        }
        if (action.type === "run_live") {
          await runWorkflow("live");
          continue;
        }
        if (action.type === "open_route") {
          navigate(normalizeRoute(action.route));
          continue;
        }
      }
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : "assistant_action_failed");
    } finally {
      setAssistantApplyBusy(false);
    }
  };

  const readiness = useMemo(() => {
    const simulationRan = executions.some((execution) => execution.mode === "simulation");
    const blockingIssues = policySnapshot?.validation.issues.filter((issue) => issue.severity === "blocking").length ?? 0;
    const policySafe = Boolean(policySnapshot?.validation.valid && blockingIssues === 0);
    const integrationsConfigured = integrations.filter((item) => item.status === "verified").length;
    const datasetLoaded =
      projectPacks.length >= 5 &&
      (commercialClaims?.claims.length ?? 0) > 0 &&
      (commercialProof?.claims.length ?? 0) > 0;

    return [
      {
        id: "sessions",
        title: "Initialize platform identities",
        detail: "Creates clinician + security sessions and connects the console to live backend data.",
        status: sessionsConnected ? "done" : "pending"
      },
      {
        id: "dataset",
        title: "Load GrumpyMan operating dataset",
        detail: datasetLoaded
          ? `Loaded ${projectPacks.length} project packs with commercial proof and claims data.`
          : "Project packs and commercial evidence are not fully loaded yet.",
        status: datasetLoaded ? "done" : sessionsConnected ? "pending" : "warning"
      },
      {
        id: "policy",
        title: "Validate policy baseline",
        detail: policySafe
          ? "Policy baseline is safe (no blocking issues)."
          : "Policy baseline needs remediation in Security Console before sign-off.",
        status: policySafe ? "done" : "warning"
      },
      {
        id: "simulation",
        title: "Run one simulation",
        detail: "Generates execution, approval, and audit artifacts for evaluator walkthrough.",
        status: simulationRan ? "done" : sessionsConnected ? "pending" : "warning"
      },
      {
        id: "integration",
        title: "Verify at least one integration",
        detail: "Completes Databricks/Fabric/Snowflake/AWS setup with verification state.",
        status: integrationsConfigured > 0 ? "done" : "pending"
      }
    ] as const;
  }, [commercialClaims, commercialProof, executions, integrations, policySnapshot, projectPacks.length, sessionsConnected]);

  const completed = readiness.filter((item) => item.status === "done").length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Start here first"
        title="Setup Center"
        subtitle="Use Initialize Platform first. It will connect identities, load live data, and prepare a simulation-ready workspace."
        actions={
          <>
            <Badge tone="info">Progress {completed}/5</Badge>
            <button
              type="button"
              className="primary"
              onClick={() => void initializePlatform()}
              disabled={isSyncing || !demoIdentitiesEnabled}
            >
              Initialize platform
            </button>
            <button type="button" onClick={() => void refreshWorkspace()} disabled={isSyncing}>
              Refresh status
            </button>
            <button type="button" onClick={() => clearError()} disabled={isSyncing}>
              Clear setup errors
            </button>
          </>
        }
      />

      <section className="split-grid">
        <Panel title="What to do now (2-minute path)" subtitle="If you are evaluating, follow this exact sequence." tone="info">
          <ol className="plain-steps">
            <li>
              <strong>Click Initialize platform.</strong> This connects demo identities and pulls all live state.
            </li>
            <li>
              <strong>Run simulation.</strong> This creates execution + evidence artifacts.
            </li>
            <li>
              <strong>Open Guides.</strong> Follow evaluator or operator workflow from one page.
            </li>
          </ol>
          <div className="pill-row">
            <button
              type="button"
              className="primary"
              onClick={() => void initializePlatform()}
              disabled={isSyncing || !demoIdentitiesEnabled}
            >
              Initialize platform
            </button>
            <button type="button" onClick={() => void runWorkflow("simulation")} disabled={!clinicianSession || isSyncing}>
              Run simulation
            </button>
            <Link className="subtle-link" to="/guides">
              Open role guides
            </Link>
          </div>
        </Panel>

        <Panel title="Readiness checks" subtitle="You are ready when these are green.">
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
        <Panel
          title="Local Setup Assistant (LLM)"
          subtitle="Ask plain-language setup questions. The assistant suggests actions and can apply them."
          tone="success"
        >
          <div className="stack">
            <div className="policy-impact-row">
              <div className="policy-impact-head">
                <strong>Assistant status</strong>
                <Badge tone={assistantStatus?.available ? "success" : "warning"}>
                  {assistantStatus?.available ? "local LLM ready" : "fallback mode"}
                </Badge>
              </div>
              <p>
                {assistantStatus
                  ? assistantStatus.message
                  : "Checking local model runtime..."}
              </p>
              {assistantStatus?.available ? (
                <small className="muted">
                  Source: {assistantStatus.source} | Model: {assistantStatus.model}
                </small>
              ) : (
                <small className="muted">
                  Install Ollama and pull a model, then refresh this page.
                </small>
              )}
            </div>
            <label className="form-field">
              <span>Ask assistant</span>
              <textarea
                value={assistantPrompt}
                onChange={(event) => setAssistantPrompt(event.target.value)}
                placeholder="Example: set everything up for evaluator mode and run the first safe simulation."
              />
            </label>
            <div className="pill-row">
              <button
                type="button"
                className="primary"
                disabled={assistantBusy || assistantPrompt.trim().length < 5}
                onClick={async () => {
                  setAssistantBusy(true);
                  setAssistantError(undefined);
                  try {
                    const response = await pilotApi.askSetupAssistant(assistantPrompt.trim());
                    setAssistantResponse(response);
                  } catch (error) {
                    setAssistantError(error instanceof Error ? error.message : "assistant_request_failed");
                  } finally {
                    setAssistantBusy(false);
                  }
                }}
              >
                {assistantBusy ? "Thinking..." : "Get setup plan"}
              </button>
              <button
                type="button"
                className="success"
                disabled={assistantApplyBusy || !assistantResponse || assistantResponse.actions.length === 0}
                onClick={() => void runAssistantActions(assistantResponse?.actions ?? [])}
              >
                {assistantApplyBusy ? "Applying..." : "Apply suggested actions"}
              </button>
            </div>
            {assistantError ? <div className="warning-copy">Assistant error: {assistantError}</div> : null}
            {assistantResponse ? (
              <div className="policy-impact-row">
                <div className="policy-impact-head">
                  <strong>Assistant output</strong>
                  <Badge tone={assistantResponse.source === "ollama" ? "success" : "warning"}>
                    {assistantResponse.source}
                  </Badge>
                </div>
                <p>{assistantResponse.summary}</p>
                <ol className="plain-steps">
                  {assistantResponse.actions.map((action, index) => (
                    <li key={`${action.type}-${index}`}>
                      <strong>{action.type}</strong>: {action.reason}
                    </li>
                  ))}
                </ol>
                {assistantResponse.followups.length > 0 ? (
                  <>
                    <strong>Follow-ups</strong>
                    <ul className="plain-steps">
                      {assistantResponse.followups.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Dataset confirmation" subtitle="This verifies the Contoso-style GrumpyMan dataset is loaded.">
          <KeyValueList
            items={[
              { label: "Tenant", value: pilotWorkspaceBlueprint.useCase.tenantId },
              { label: "Project packs", value: String(projectPacks.length) },
              { label: "Commercial claims", value: String(commercialClaims?.claims.length ?? 0) },
              { label: "Commercial proof claims", value: String(commercialProof?.claims.length ?? 0) },
              {
                label: "Outcome",
                value:
                  projectPacks.length >= 5
                    ? "Dataset is loaded and available for evaluator/operator walkthroughs."
                    : "Dataset is not fully loaded. Click Initialize platform and Refresh status."
              }
            ]}
          />
        </Panel>
      </section>
    </div>
  );
};
