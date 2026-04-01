import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { isDemoIdentitiesEnabled } from "../security-guards.js";
import { Badge, EmptyState, MetricTile, Panel, PageHeader, Table } from "../ui.js";
import type { ApprovalRecord, ExecutionRecord, ProjectPackDefinition } from "../../shared/api/pilot.js";
import type { Tone } from "../ui.js";

type PersonaView = "operator" | "security" | "executive";

type PackGuide = {
  hero: string;
  wins: string[];
  settings: Array<{ label: string; required: string; safe: string; why: string; risk: string }>;
  ops: string[];
  scenarios: Array<{
    title: string;
    mode: "simulation" | "live";
    classification: ProjectPackDefinition["defaultClassification"];
    zeroRetentionRequested: boolean;
    expected: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
    watch: string;
  }>;
  approval: { trigger: string; approver: string; checks: string[] };
  screenshots: Array<{ label: string; file: string; use: string }>;
};

type PersonaMetric = {
  label: string;
  value: string | number;
  detail: string;
  tone: Tone;
};

const GUIDE_CONTENT: Record<ProjectPackDefinition["packId"], PackGuide> = {
  "secops-runtime-guard": {
    hero: "Contain runtime threats with human approval for live actions and default-deny handling for exfiltration.",
    wins: ["Threat triage, approval, and evidence stay in one flow.", "Simulation and live paths are visibly different.", "High-risk actions become defensible to CISO and audit teams."],
    settings: [
      { label: "Kafka alert source", required: "secops.runtime.alerts", safe: "Read-only consumer", why: "Starts the workflow from real alerts.", risk: "Wrong topic or write access can hide or corrupt alerts." },
      { label: "Grafana workspace", required: "Incident correlation dashboard", safe: "Read-only service identity", why: "Gives context before a live action is approved.", risk: "Operators approve with stale or missing context." },
      { label: "Approval group", required: "AAL3 SecOps approvers", safe: "Security reviewer persona", why: "Critical containment needs the right human.", risk: "The run pauses for someone who cannot approve." }
    ],
    ops: ["Review critical alerts first.", "Run simulation before unfamiliar live actions.", "Approve only after alert, dashboard, and ticket context match."],
    scenarios: [
      { title: "Practice host isolation", mode: "simulation", classification: "SECRET", zeroRetentionRequested: true, expected: "ALLOW", watch: "Execution completes with evidence and no approval." },
      { title: "Execute live host isolation", mode: "live", classification: "SECRET", zeroRetentionRequested: true, expected: "REQUIRE_APPROVAL", watch: "Live run blocks until approved." },
      { title: "Attempt unsafe export", mode: "live", classification: "SECRET", zeroRetentionRequested: false, expected: "DENY", watch: "Unsafe route should stay blocked." }
    ],
    approval: { trigger: "Live isolate-host action", approver: "Security reviewer persona", checks: ["Severity is high or critical", "Target asset is correct", "Evidence matches the request"] },
    screenshots: [
      { label: "Project gallery", file: "docs/assets/screenshots/commercial-projects.png", use: "Show pack selection and trust proof entry." },
      { label: "Approval inbox", file: "docs/assets/screenshots/commercial-approvals.png", use: "Show the human approval checkpoint." }
    ]
  },
  "revenue-cycle-copilot": {
    hero: "Reduce denial backlog without letting PHI routing or finance writebacks bypass review.",
    wins: ["Claims, appeals, and dashboards stay in one governed path.", "PHI safety is visible, not hidden in prompts.", "Finance can prove faster turnaround with evidence."],
    settings: [
      { label: "Trino denial dataset", required: "Current governed denials view", safe: "Read-only warehouse role", why: "Feeds triage with live financial context.", risk: "Analysts work stale or incomplete denials." },
      { label: "Airflow appeal DAG", required: "Approved appeal workflow", safe: "Restricted DAG prefix", why: "Creates the safe handoff to finance operations.", risk: "The wrong finance job runs." },
      { label: "Zero-retention route", required: "Enabled for PHI", safe: "On", why: "PHI must stay on approved model paths.", risk: "A simple summary becomes a compliance failure." }
    ],
    ops: ["Start with highest-value denials.", "Simulate before live writeback.", "Watch dashboard publication and DLP evidence."],
    scenarios: [
      { title: "Draft appeal worklist", mode: "simulation", classification: "PHI", zeroRetentionRequested: true, expected: "ALLOW", watch: "Simulation should finish with traceable evidence." },
      { title: "Post live appeal outcome", mode: "live", classification: "PHI", zeroRetentionRequested: true, expected: "REQUIRE_APPROVAL", watch: "Writeback waits on approval." },
      { title: "Try non-zero-retention PHI route", mode: "live", classification: "PHI", zeroRetentionRequested: false, expected: "DENY", watch: "Unsafe PHI route remains blocked." }
    ],
    approval: { trigger: "Live appeal writeback", approver: "Security reviewer", checks: ["Write target is correct", "PHI stays on zero-retention route", "Outbound summary meets DLP expectation"] },
    screenshots: [
      { label: "Business dashboard", file: "docs/assets/screenshots/commercial-dashboard.png", use: "Show finance KPI framing." },
      { label: "Security console", file: "docs/assets/screenshots/commercial-security.png", use: "Show policy before live writeback." }
    ]
  },
  "supply-chain-resilience": {
    hero: "Turn shortage detection into safe operational action without duplicate or runaway automation.",
    wins: ["Inventory, orchestration, and tasking stay in one control path.", "Approvals are visible for procurement actions.", "Execution budgets stop noisy automation."],
    settings: [
      { label: "Airbyte inventory sync", required: "Current shortage watchlist", safe: "Read-only sync", why: "Fresh shortage data makes the dashboard credible.", risk: "The wrong shortage gets escalated." },
      { label: "Dagster run scope", required: "Approved resilience jobs only", safe: "Restricted code location", why: "Keeps orchestration bounded.", risk: "Wrong replenishment jobs can run." },
      { label: "Linear task project", required: "Supply mitigation backlog", safe: "One team, one project", why: "Shows visible owner accountability.", risk: "Tasks scatter and ownership disappears." }
    ],
    ops: ["Review the watchlist before the task queue.", "Keep budgets low unless a fallback path is proven.", "Approve procurement only when shortage and owner are both correct."],
    scenarios: [
      { title: "Draft mitigation plan", mode: "simulation", classification: "INTERNAL", zeroRetentionRequested: true, expected: "ALLOW", watch: "Simulation should create a safe mitigation path." },
      { title: "Create live purchase order", mode: "live", classification: "CONFIDENTIAL", zeroRetentionRequested: true, expected: "REQUIRE_APPROVAL", watch: "Live procurement waits on approval." },
      { title: "Over-budget fallback chain", mode: "simulation", classification: "INTERNAL", zeroRetentionRequested: true, expected: "DENY", watch: "Budget warning should stay visible." }
    ],
    approval: { trigger: "Live procurement write", approver: "Security reviewer or platform admin", checks: ["Shortage is current", "Write scope is approved", "Action is not already in progress"] },
    screenshots: [
      { label: "Integration hub", file: "docs/assets/screenshots/commercial-integrations.png", use: "Show connector readiness." },
      { label: "Workflow view", file: "docs/assets/screenshots/commercial-workflow.png", use: "Show the route from data to approval." }
    ]
  },
  "clinical-quality-signal": {
    hero: "Detect patient-quality risks earlier while keeping ePHI and outbound actions tightly controlled.",
    wins: ["Purpose, route, and approval stay visible around clinical AI work.", "Clinicians can see what is safe before live notifications go out.", "Quality committees get traceable evidence."],
    settings: [
      { label: "FHIR quality feed", required: "Encounter and outcome bundle", safe: "Purpose-restricted OAuth client", why: "This is the patient context behind the signal.", risk: "Signal quality degrades and trust drops." },
      { label: "HL7 notification queue", required: "Outbound care-team channel", safe: "Approved queue with DLP", why: "Patient-impacting communication needs a controlled path.", risk: "A bad setup can send the wrong message or leak PHI." },
      { label: "Clinical baseline policy", required: "Zero-retention and approval enabled", safe: "On", why: "This is the minimum safe posture for ePHI.", risk: "The pack stops being defensible in a regulated setting." }
    ],
    ops: ["Review highest-risk signals first.", "Use simulation when changing signal logic.", "Treat every live outbound notification as patient-impacting."],
    scenarios: [
      { title: "Score signals in simulation", mode: "simulation", classification: "EPHI", zeroRetentionRequested: true, expected: "ALLOW", watch: "Simulation should create evidence without live messaging." },
      { title: "Send live care-team alert", mode: "live", classification: "PHI", zeroRetentionRequested: true, expected: "REQUIRE_APPROVAL", watch: "Approval must happen before notification completes." },
      { title: "Disable zero retention", mode: "live", classification: "EPHI", zeroRetentionRequested: false, expected: "DENY", watch: "Unsafe route should stay blocked." }
    ],
    approval: { trigger: "High-risk live care-team notification", approver: "Security reviewer", checks: ["Signal is clinically valid", "Patient and care team are correct", "Route remains zero-retention and DLP-safe"] },
    screenshots: [
      { label: "Simulation lab", file: "docs/assets/screenshots/commercial-simulation.png", use: "Show dry-run capability before patient-impacting actions." },
      { label: "Audit explorer", file: "docs/assets/screenshots/commercial-audit.png", use: "Show evidence chain for committees and reviewers." }
    ]
  },
  "board-risk-cockpit": {
    hero: "Give leaders evidence-backed board reporting without letting confidential publication go unreviewed.",
    wins: ["Risk reporting becomes a controlled workflow instead of a document scramble.", "Claims are tied to evidence so executive statements are defensible.", "Disclosure control is visible for board-facing output."],
    settings: [
      { label: "Risk register federation", required: "Approved cross-domain risk view", safe: "Read-only governed schema", why: "Executives need one source of truth.", risk: "Board material becomes inconsistent or incomplete." },
      { label: "Board repository", required: "Restricted document library", safe: "Board-only site", why: "Publication must stay inside the intended audience.", risk: "A routine publish turns into an exposure event." },
      { label: "Evidence reference rule", required: "Every claim links to evidence", safe: "Mandatory", why: "Leadership needs traceable support for each statement.", risk: "The output is not defensible even if it looks polished." }
    ],
    ops: ["Review top risks and check which are evidence-backed.", "Keep live publication behind approvals.", "Use the dashboard to find stale claims before board prep starts."],
    scenarios: [
      { title: "Assemble draft board brief", mode: "simulation", classification: "CONFIDENTIAL", zeroRetentionRequested: true, expected: "ALLOW", watch: "Simulation should create a safe draft path." },
      { title: "Publish live board brief", mode: "live", classification: "CONFIDENTIAL", zeroRetentionRequested: true, expected: "REQUIRE_APPROVAL", watch: "Publication should wait on approval." },
      { title: "Distribute outside board audience", mode: "live", classification: "CONFIDENTIAL", zeroRetentionRequested: true, expected: "DENY", watch: "Disclosure control should remain clear and strict." }
    ],
    approval: { trigger: "Live board brief publication", approver: "Security reviewer or platform admin", checks: ["Audience is board-only", "Critical claims have evidence references", "Confidential content stays in approved channels"] },
    screenshots: [
      { label: "Commercial readiness", file: "docs/assets/screenshots/commercial-readiness.png", use: "Show the leadership proof story." },
      { label: "Admin console", file: "docs/assets/screenshots/commercial-admin.png", use: "Show governance context around the pack." }
    ]
  }
};

const personaTrendLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const trendSeries: Record<ProjectPackDefinition["packId"], Record<PersonaView, number[]>> = {
  "secops-runtime-guard": { operator: [4, 6, 5, 7, 5, 3, 2], security: [3, 4, 4, 5, 3, 2, 2], executive: [82, 84, 85, 88, 90, 92, 94] },
  "revenue-cycle-copilot": { operator: [18, 16, 15, 13, 12, 11, 10], security: [5, 5, 4, 4, 3, 3, 2], executive: [71, 74, 76, 79, 81, 83, 86] },
  "supply-chain-resilience": { operator: [9, 8, 8, 7, 6, 5, 5], security: [2, 2, 3, 2, 2, 1, 1], executive: [68, 69, 72, 75, 76, 79, 81] },
  "clinical-quality-signal": { operator: [11, 12, 11, 10, 9, 8, 8], security: [4, 4, 3, 3, 3, 2, 2], executive: [73, 75, 76, 78, 81, 84, 86] },
  "board-risk-cockpit": { operator: [7, 7, 6, 5, 5, 4, 4], security: [2, 2, 2, 2, 1, 1, 1], executive: [77, 79, 81, 83, 85, 88, 90] }
};

const decisionTone = (effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY") => {
  if (effect === "ALLOW") return "success" as const;
  if (effect === "REQUIRE_APPROVAL") return "warning" as const;
  return "danger" as const;
};

const sortNewest = <T,>(items: T[], getTimestamp: (item: T) => string | undefined) =>
  items.slice().sort((left, right) => {
    const rightTime = new Date(getTimestamp(right) ?? 0).getTime();
    const leftTime = new Date(getTimestamp(left) ?? 0).getTime();
    return rightTime - leftTime;
  });

const countByStatus = (executions: ExecutionRecord[], status: ExecutionRecord["status"]) =>
  executions.filter((execution) => execution.status === status).length;

const approvalTone = (approval: ApprovalRecord | undefined) => {
  if (!approval) return "success" as const;
  return approval.status === "pending" ? "warning" : approval.status === "rejected" ? "danger" as const : "success" as const;
};

export const ProjectPackDetailPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectPacks = usePilotWorkspace((state) => state.projectPacks);
  const experiences = usePilotWorkspace((state) => state.projectPackExperiences);
  const executions = usePilotWorkspace((state) => state.executions);
  const approvals = usePilotWorkspace((state) => state.approvals);
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const incidents = usePilotWorkspace((state) => state.incidents);
  const activePersona = usePilotWorkspace((state) => state.activePersona);
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const loadProjectPackExperience = usePilotWorkspace((state) => state.loadProjectPackExperience);
  const runProjectPack = usePilotWorkspace((state) => state.runProjectPack);
  const decideApproval = usePilotWorkspace((state) => state.decideApproval);
  const applyProjectPackPolicyPreset = usePilotWorkspace((state) => state.applyProjectPackPolicyPreset);
  const [personaView, setPersonaView] = useState<PersonaView>(activePersona === "security" ? "security" : "operator");
  const [statusMessage, setStatusMessage] = useState("");
  const demoIdentitiesEnabled = isDemoIdentitiesEnabled();

  const packId = (searchParams.get("pack") ?? "") as ProjectPackDefinition["packId"];
  const selectedPack = projectPacks.find((pack) => pack.packId === packId) ?? projectPacks[0];
  const guide = selectedPack ? GUIDE_CONTENT[selectedPack.packId] : undefined;
  const selectedExperience = selectedPack ? experiences[selectedPack.packId] : undefined;

  useEffect(() => {
    if (!selectedPack) return;
    if (searchParams.get("pack") === selectedPack.packId) return;
    const next = new URLSearchParams(searchParams);
    next.set("pack", selectedPack.packId);
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedPack, setSearchParams]);

  useEffect(() => {
    if (!selectedPack || experiences[selectedPack.packId]) return;
    void loadProjectPackExperience(selectedPack.packId);
  }, [experiences, loadProjectPackExperience, selectedPack]);

  useEffect(() => {
    setPersonaView(activePersona === "security" ? "security" : "operator");
  }, [activePersona]);

  const packExecutions = useMemo(() => {
    if (!selectedPack) return [];
    return sortNewest(
      executions.filter((execution) => execution.workflowId === selectedPack.workflowId),
      (execution) => execution.updatedAt ?? execution.createdAt
    );
  }, [executions, selectedPack]);

  const executionIds = useMemo(() => new Set(packExecutions.map((execution) => execution.executionId)), [packExecutions]);
  const packApprovals = useMemo(
    () =>
      sortNewest(
        approvals.filter((approval) => approval.executionId && executionIds.has(approval.executionId)),
        (approval) => approval.createdAt
      ),
    [approvals, executionIds]
  );
  const packIncidents = useMemo(
    () =>
      sortNewest(
        incidents.filter((incident) => incident.executionId && executionIds.has(incident.executionId)),
        (incident) => incident.detectedAt
      ),
    [executionIds, incidents]
  );
  const packAuditEvents = useMemo(
    () =>
      sortNewest(
        auditEvents.filter((event) => {
          const executionId = event.details.executionId;
          return typeof executionId === "string" && executionIds.has(executionId);
        }),
        (event) => event.timestamp
      ),
    [auditEvents, executionIds]
  );

  const latestExecution = packExecutions[0];
  const pendingApproval = packApprovals.find((approval) => approval.status === "pending");
  const selectedTable = selectedExperience?.experience.dataTables[0];
  const trendValues = selectedPack ? trendSeries[selectedPack.packId][personaView] : [];
  const trendMax = Math.max(1, ...trendValues);
  const executiveScore = selectedPack ? trendSeries[selectedPack.packId].executive.at(-1) ?? 0 : 0;

  const personaMetrics: PersonaMetric[] =
    personaView === "operator"
      ? [
          { label: "Executions", value: packExecutions.length, detail: "Completed, blocked, and failed runs for this pack.", tone: "info" as const },
          { label: "Blocked for review", value: countByStatus(packExecutions, "blocked"), detail: "Human checkpoints waiting for action.", tone: countByStatus(packExecutions, "blocked") > 0 ? "warning" as const : "success" as const },
          { label: "Completed", value: countByStatus(packExecutions, "completed"), detail: "Evidence-backed runs that reached the finish line.", tone: "success" as const },
          { label: "Tool calls", value: packExecutions.reduce((total, execution) => total + execution.toolCalls.length, 0), detail: "Bounded actions executed by OpenAegis.", tone: "default" as const }
        ]
      : personaView === "security"
        ? [
            { label: "Pending approvals", value: packApprovals.filter((approval) => approval.status === "pending").length, detail: "Review these before live activity can continue.", tone: approvalTone(pendingApproval) },
            { label: "Open incidents", value: packIncidents.filter((incident) => incident.status !== "resolved").length, detail: "Derived from blocked runs, approvals, and audit signals.", tone: packIncidents.some((incident) => incident.status !== "resolved") ? "warning" as const : "success" as const },
            { label: "Trust checks", value: selectedExperience?.experience.trustChecks.length ?? 0, detail: "Always-on controls this pack proves in the UI.", tone: "info" as const },
            { label: "Audit events", value: packAuditEvents.length, detail: "Replayable evidence records tied to this pack.", tone: "default" as const }
          ]
        : [
            { label: "KPI readiness", value: `${executiveScore}%`, detail: "Seeded executive trend for the pack outcome story.", tone: executiveScore >= 85 ? "success" as const : "warning" as const },
            { label: "Approvals closed", value: packApprovals.filter((approval) => approval.status === "approved").length, detail: "High-risk actions completed with human sign-off.", tone: "success" as const },
            { label: "Incidents contained", value: packIncidents.filter((incident) => incident.status === "contained" || incident.status === "resolved").length, detail: "Operational issues resolved before impact spreads.", tone: "info" as const },
            { label: "Evidence packages", value: packExecutions.filter((execution) => execution.evidenceId).length, detail: "Runs ready for audit, executive review, and replay.", tone: "default" as const }
          ];

  if (!selectedPack || !guide) {
    return (
      <Panel title="Project guide unavailable" subtitle="Load project packs first.">
        <EmptyState title="No pack selected" description="Open the project gallery, load a pack, then return here for the guided walkthrough." />
      </Panel>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Project-pack walkthrough"
        title={selectedPack.name}
        subtitle="Follow the same order a new evaluator should follow: connect, configure, apply the safe baseline, simulate, approve, run live, and watch daily operations through persona dashboards."
        actions={
          <>
            <Badge tone="info">{selectedPack.industry}</Badge>
            <Badge tone="warning">{selectedPack.defaultClassification}</Badge>
            <Link className="subtle-link" to="/projects">
              Back to gallery
            </Link>
          </>
        }
      />

      <section className="pack-hero-card">
        <div className="pack-hero-copy">
          <div className="eyebrow">Why this pack matters</div>
          <h3>{selectedPack.businessProblem}</h3>
          <p>{guide.hero}</p>
          <div className="pill-row">
            <Badge tone="info">Workflow: {selectedPack.workflowId}</Badge>
            <Badge tone={latestExecution ? "success" : "default"}>{latestExecution ? `Latest ${latestExecution.status}` : "No run yet"}</Badge>
            <Badge tone={pendingApproval ? "warning" : "success"}>{pendingApproval ? "Approval waiting" : "No pending approvals"}</Badge>
          </div>
        </div>
        <div className="pack-hero-proof">
          {guide.wins.map((win) => (
            <div key={win} className="hero-proof-item">
              <strong>OpenAegis proof</strong>
              <p>{win}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="project-pack-tabs" aria-label="Project packs">
        {projectPacks.map((pack) => (
          <button
            key={pack.packId}
            type="button"
            className={pack.packId === selectedPack.packId ? "scenario-card active" : "scenario-card"}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("pack", pack.packId);
              setSearchParams(next);
              setStatusMessage("");
            }}
          >
            <strong>{pack.name}</strong>
            <p>{pack.expectedOutcome}</p>
          </button>
        ))}
      </section>

      <section className="metric-grid compact-metrics">
        {personaMetrics.map((metric) => (
          <MetricTile key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone} />
        ))}
      </section>

      <section className="split-grid">
        <Panel title="1. Settings a non-expert can validate" subtitle="Each setting says what to enter, the safest default, and what can go wrong if it changes.">
          <div className="stack">
            {guide.settings.map((setting) => (
              <article key={setting.label} className="guide-setting-card">
                <div className="service-top">
                  <strong>{setting.label}</strong>
                  <Badge tone="info">Safe default: {setting.safe}</Badge>
                </div>
                <p><strong>Required:</strong> {setting.required}</p>
                <p>{setting.why}</p>
                <p className="warning-copy"><strong>Impact warning:</strong> {setting.risk}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="2. Apply the secure baseline" subtitle="This is the safe starting point before anyone runs live actions.">
          <div className="guide-check-card">
            <strong>What OpenAegis will enforce</strong>
            <ul className="plain-steps">
              <li>High-risk live work requires human approval.</li>
              <li>PHI, ePHI, and sensitive data stay on approved zero-retention routes.</li>
              <li>Outbound actions keep DLP and evidence turned on.</li>
            </ul>
          </div>
          <div className="guide-action-strip">
            {demoIdentitiesEnabled ? (
              <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                {clinicianSession || securitySession ? "Reconnect evaluator identities" : "Connect evaluator identities"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void applyProjectPackPolicyPreset(selectedPack.packId).then((snapshot) => {
                  setStatusMessage(
                    snapshot
                      ? `Secure baseline applied: ${snapshot.profile.profileName} v${snapshot.profile.profileVersion}.`
                      : "Secure baseline failed. Use the security persona and retry."
                  );
                })
              }
              disabled={!securitySession || isSyncing}
            >
              Apply secure baseline
            </button>
          </div>
          <p className="muted">Hint: use the clinician persona to run work and the security persona to approve or apply policy changes.</p>
          {statusMessage ? <div className="banner info">{statusMessage}</div> : null}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="3. Run the pack in the right order" subtitle="Simulation proves the path safely. Live mode shows the approval gate and evidence chain.">
          <div className="scenario-grid-3">
            {guide.scenarios.map((scenario) => (
              <article key={scenario.title} className="scenario-run-card">
                <div className="service-top">
                  <strong>{scenario.title}</strong>
                  <Badge tone={decisionTone(scenario.expected)}>{scenario.expected}</Badge>
                </div>
                <p><strong>Mode:</strong> {scenario.mode}</p>
                <p><strong>Classification:</strong> {scenario.classification}</p>
                <p><strong>Zero retention:</strong> {scenario.zeroRetentionRequested ? "Required" : "Off to prove the deny path"}</p>
                <p>{scenario.watch}</p>
                <button
                  type="button"
                  className={scenario.mode === "live" ? "success" : "primary"}
                  onClick={() =>
                    void runProjectPack(selectedPack.packId, scenario.mode, {
                      requestFollowupEmail: true,
                      classification: scenario.classification,
                      zeroRetentionRequested: scenario.zeroRetentionRequested
                    }).then((execution) => {
                      setStatusMessage(
                        execution
                          ? `Started ${scenario.mode} run ${execution.executionId} with status ${execution.status}.`
                          : `Unable to start ${scenario.title}. Check identities and retry.`
                      );
                    })
                  }
                  disabled={!clinicianSession || isSyncing}
                >
                  Run {scenario.mode}
                </button>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="4. Human-in-the-middle approval" subtitle="Use this panel to explain what gets reviewed, by whom, and why the system pauses.">
          <div className="guide-check-card">
            <strong>Approval trigger</strong>
            <p>{guide.approval.trigger}</p>
            <p><strong>Approver:</strong> {guide.approval.approver}</p>
            <ul className="plain-steps">
              {guide.approval.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
          {pendingApproval ? (
            <div className="stack">
              <article className="guide-setting-card">
                <div className="service-top">
                  <strong>{pendingApproval.approvalId}</strong>
                  <Badge tone={approvalTone(pendingApproval)}>{pendingApproval.status}</Badge>
                </div>
                <p><strong>Reason:</strong> {pendingApproval.reason}</p>
                <p><strong>Risk:</strong> {pendingApproval.riskLevel}</p>
                <p><strong>Expires:</strong> {new Date(pendingApproval.expiresAt).toLocaleString()}</p>
              </article>
              <button
                type="button"
                className="success"
                onClick={() =>
                  void decideApproval(pendingApproval.approvalId, "approve", `Approved from guided walkthrough for ${selectedPack.name}.`).then((approval) => {
                    setStatusMessage(
                      approval ? `Approval ${approval.approvalId} recorded as ${approval.status}.` : "Approval update failed."
                    );
                  })
                }
                disabled={!securitySession || isSyncing}
              >
                Approve current request
              </button>
            </div>
          ) : (
            <EmptyState title="No approval pending" description="Run a live scenario to show the approval queue and then return here to approve it." />
          )}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="5. Daily operations" subtitle="This is the checklist an operator can follow after the initial setup is done.">
          <ol className="plain-steps">
            {guide.ops.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Panel>

        <Panel title="6. Persona dashboards" subtitle="Switch views to explain what each audience sees without changing the underlying controls.">
          <div className="pill-row persona-row">
            {(["operator", "security", "executive"] as PersonaView[]).map((view) => (
              <button key={view} type="button" className={personaView === view ? "persona-chip active" : "persona-chip"} onClick={() => setPersonaView(view)} aria-pressed={personaView === view}>
                {view}
              </button>
            ))}
          </div>
          <div className="trend-card">
            <div className="service-top">
              <strong>{personaView === "operator" ? "Operational workload" : personaView === "security" ? "Approval and risk pressure" : "Outcome confidence"}</strong>
              <Badge tone={personaView === "executive" ? "success" : "info"}>7-day seeded demo trend</Badge>
            </div>
            <div className="trend-bars" aria-label="Seeded pack trend">
              {trendValues.map((value, index) => (
                <div key={`${personaTrendLabels[index]}-${value}`} className="trend-bar-wrap">
                  <div className="trend-bar" style={{ height: `${Math.max((value / trendMax) * 100, 18)}%` }} />
                  <span>{personaTrendLabels[index]}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="7. Scenario drilldown and trust layer" subtitle="Use these artifacts to prove the controls are real and not hidden in the model.">
          {!selectedExperience ? (
            <p className="muted">Loading pack experience...</p>
          ) : (
            <div className="stack">
              <div className="table-wrap guide-table-card">
                <Table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Mode</th>
                      <th>Decision</th>
                      <th>Operator hint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedExperience.experience.policyScenarios.map((scenario) => (
                      <tr key={scenario.scenarioId}>
                        <td>{scenario.title}</td>
                        <td>{scenario.input.mode}</td>
                        <td><Badge tone={decisionTone(scenario.decision?.effect ?? "DENY")}>{scenario.decision?.effect ?? "N/A"}</Badge></td>
                        <td>{scenario.operatorHint}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {selectedExperience.experience.trustChecks.map((check) => (
                <div key={check} className="guide-check-card">
                  <strong>Trust check</strong>
                  <p>{check}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="8. What the UI should point to" subtitle="Use these references while building screenshots and evaluator training. They make the walkthrough concrete.">
          <div className="stack">
            {guide.screenshots.map((shot) => (
              <article key={shot.file} className="guide-setting-card">
                <div className="service-top">
                  <strong>{shot.label}</strong>
                  <Badge tone="info">Screenshot reference</Badge>
                </div>
                <p><code>{shot.file}</code></p>
                <p>{shot.use}</p>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Seeded business data" subtitle="Use the first table below when you explain how the pack gets context before it acts.">
          {!selectedTable ? (
            <p className="muted">No seeded tables found for this pack yet.</p>
          ) : (
            <>
              <p className="muted">{selectedTable.description}</p>
              <div className="table-wrap guide-table-card">
                <Table>
                  <thead>
                    <tr>
                      {selectedTable.columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTable.rows.map((row, rowIndex) => (
                      <tr key={`${selectedTable.tableId}-${rowIndex}`}>
                        {selectedTable.columns.map((column) => (
                          <td key={`${selectedTable.tableId}-${rowIndex}-${column.key}`}>{String(row[column.key] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="pill-row">
                <Badge tone="warning">{selectedTable.classification}</Badge>
                <Badge tone="default">{selectedTable.source}</Badge>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Live operational snapshot" subtitle="This links the walkthrough to the actual runtime state for the selected pack.">
          <div className="stack">
            <article className="guide-setting-card">
              <div className="service-top">
                <strong>{latestExecution ? latestExecution.executionId : "No run yet"}</strong>
                <Badge tone={latestExecution?.status === "completed" ? "success" : latestExecution ? "warning" : "default"}>
                  {latestExecution?.status ?? "idle"}
                </Badge>
              </div>
              <p><strong>Current step:</strong> {latestExecution?.currentStep ?? "Run a scenario to populate live state."}</p>
              <p><strong>Evidence:</strong> {latestExecution?.evidenceId ?? "No evidence generated yet."}</p>
              <p><strong>Risk flags:</strong> {latestExecution?.output?.riskFlags.join(", ") || "None returned yet."}</p>
            </article>
            <article className="guide-setting-card">
              <strong>Audit and incident view</strong>
              <p>{packAuditEvents.length} audit events are linked to this pack.</p>
              <p>{packIncidents.length} incidents are currently derived from this pack's activity.</p>
              <p className="muted">Use Audit Explorer and Incident Review after this walkthrough for deeper investigation.</p>
            </article>
          </div>
        </Panel>
      </section>
    </div>
  );
};
