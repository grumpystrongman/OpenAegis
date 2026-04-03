import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { SessionContext, UserRole } from "../shared/auth/session.js";
import { APP_ROUTES } from "./routes.js";
import { canAccessRouteWithAssurance, isDemoIdentitiesEnabled } from "./security-guards.js";
import { Badge, EmptyState, PageHeader } from "./ui.js";
import { PILOT_USE_CASE } from "./pilot-data.js";
import { usePilotWorkspace } from "./pilot-workspace.js";

const supportedRoles: UserRole[] = [
  "platform_admin",
  "security_admin",
  "auditor",
  "workflow_operator",
  "approver",
  "analyst"
];

const toSessionContext = (
  session: {
    user: {
      userId: string;
      tenantId: string;
      roles: string[];
      assuranceLevel: "aal1" | "aal2" | "aal3";
    };
  } | undefined
): SessionContext | undefined => {
  if (!session) return undefined;
  const roles = session.user.roles.filter((role): role is UserRole =>
    supportedRoles.includes(role as UserRole)
  );
  return {
    userId: session.user.userId,
    tenantId: session.user.tenantId,
    roles,
    assuranceLevel: session.user.assuranceLevel
  };
};

const sectionMeta: Record<
  "foundation" | "operate" | "govern",
  { title: string; summary: string }
> = {
  foundation: {
    title: "1. Foundation",
    summary: "First-run setup, outcomes, and integrations."
  },
  operate: {
    title: "2. Operate",
    summary: "Build, run, and approve agent workflows."
  },
  govern: {
    title: "3. Govern",
    summary: "Identity, security, incidents, and audit evidence."
  }
};

type WorkspaceMode = "all" | "evaluator" | "operator" | "governance";

const workspaceModeMeta: Record<WorkspaceMode, { label: string; summary: string }> = {
  all: {
    label: "All surfaces",
    summary: "Show every route for broad platform administration."
  },
  evaluator: {
    label: "Evaluator flow",
    summary: "Demo-first workflow focused on onboarding and proof."
  },
  operator: {
    label: "Operator flow",
    summary: "Run-time workflow for daily operations and approvals."
  },
  governance: {
    label: "Governance flow",
    summary: "Security, identity, audit, and policy control workflow."
  }
};

const workspaceModeRoutes: Record<Exclude<WorkspaceMode, "all">, Set<string>> = {
  evaluator: new Set(["/setup", "/guides", "/dashboard", "/commercial", "/projects", "/project-guide", "/sandbox-proof", "/audit"]),
  operator: new Set(["/setup", "/guides", "/integrations", "/agents", "/workflows", "/simulation", "/approvals", "/incidents", "/audit"]),
  governance: new Set(["/setup", "/guides", "/identity", "/admin", "/security", "/approvals", "/incidents", "/audit", "/commercial"])
};

const mapWorkspaceError = (error: string | undefined): string | undefined => {
  if (!error) return undefined;
  if (error === "setup_required_connect_identities") return "Setup required: initialize identities first, then reload live data.";
  if (error === "demo_auth_disabled") return "Demo login is disabled on the gateway. Enable insecure demo auth for local onboarding.";
  if (error === "invalid_credentials") return "Configured demo users are missing from backend state. Reseed the GrumpyMan dataset.";
  if (error === "platform_initialization_failed") return "Platform initialization did not complete. Retry once.";
  return `Sync error: ${error}`;
};

export const App = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentRoute = useMemo(() => {
    return APP_ROUTES.find((route) => route.path === location.pathname) ?? APP_ROUTES[0]!;
  }, [location.pathname]);
  const demoIdentitiesEnabled = isDemoIdentitiesEnabled();

  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const activePersona = usePilotWorkspace((state) => state.activePersona);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const error = usePilotWorkspace((state) => state.error);
  const lastSyncedAt = usePilotWorkspace((state) => state.lastSyncedAt);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const initializePlatform = usePilotWorkspace((state) => state.initializePlatform);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const boot = usePilotWorkspace((state) => state.boot);
  const setActivePersona = usePilotWorkspace((state) => state.setActivePersona);
  const clearError = usePilotWorkspace((state) => state.clearError);
  const [showTechnicalContext, setShowTechnicalContext] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("evaluator");
  const activeSession = activePersona === "clinician" ? clinicianSession : securitySession;
  const activeContext = useMemo(() => toSessionContext(activeSession), [activeSession]);
  const guidedRoutes = useMemo(() => new Set(["/setup", "/guides", "/integrations", "/identity"]), []);
  const activeModeRouteSet = workspaceMode === "all" ? undefined : workspaceModeRoutes[workspaceMode];
  const routeAccess = useMemo(
    () =>
      APP_ROUTES.map((route) => ({
        route,
        allowed: activeContext ? canAccessRouteWithAssurance(activeContext, route) : route.path === "/setup",
        visibleInMode: activeModeRouteSet ? activeModeRouteSet.has(route.path) : true
      })),
    [activeContext, activeModeRouteSet]
  );
  const routesBySection = useMemo(() => {
    const order: Array<"foundation" | "operate" | "govern"> = ["foundation", "operate", "govern"];
    return order.map((section) => ({
      section,
      meta: sectionMeta[section],
      items: routeAccess.filter(({ route, visibleInMode }) => route.section === section && visibleInMode),
      hiddenCount: routeAccess.filter(({ route, visibleInMode }) => route.section === section && !visibleInMode).length
    }));
  }, [routeAccess]);
  const hasRouteAccess = activeContext ? canAccessRouteWithAssurance(activeContext, currentRoute) : currentRoute.path === "/setup";
  const isGuidedRoute = guidedRoutes.has(currentRoute.path);
  const needsStepUpAssurance = Boolean(activeContext && currentRoute.requireStepUpMfa && activeContext.assuranceLevel !== "aal3");
  const isCurrentRouteInMode = activeModeRouteSet ? activeModeRouteSet.has(currentRoute.path) : true;
  const friendlyError = mapWorkspaceError(error);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (hasRouteAccess || location.pathname === "/setup") return;
    navigate("/setup", { replace: true });
  }, [hasRouteAccess, location.pathname, navigate]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/OpenAegisLogo.png" alt="OpenAegis logo" />
          </div>
          <div>
            <div className="brand-name">OpenAegis</div>
            <div className="brand-subtitle">Vendor-neutral, policy-enforced, zero-trust pilot</div>
          </div>
        </div>

        <section className="sidebar-panel">
          <div className="sidebar-panel-label">Pilot use case</div>
          <h1>{PILOT_USE_CASE.title}</h1>
          <p>{PILOT_USE_CASE.subtitle}</p>
          <div className="sidebar-chip-row">
            <Badge tone="info">{PILOT_USE_CASE.classification}</Badge>
            <Badge tone="warning">{PILOT_USE_CASE.tenantId}</Badge>
            <Badge tone="success">Live backend</Badge>
          </div>
        </section>

        <section className="sidebar-panel">
          <div className="sidebar-panel-label">Workspace mode</div>
          <p>{workspaceModeMeta[workspaceMode].summary}</p>
          <div className="mode-row">
            {(Object.keys(workspaceModeMeta) as WorkspaceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={workspaceMode === mode ? "mode-chip active" : "mode-chip"}
                onClick={() => setWorkspaceMode(mode)}
              >
                {workspaceModeMeta[mode].label}
              </button>
            ))}
          </div>
        </section>

        <nav className="sidebar-nav" aria-label="OpenAegis sections">
          {routesBySection.map(({ section, meta, items, hiddenCount }) => (
            <section key={section} className="nav-section">
              <div className="nav-section-title">
                {meta.title}
                {hiddenCount > 0 ? <span className="nav-section-hidden">+{hiddenCount} hidden by mode</span> : null}
              </div>
              <div className="nav-section-summary">{meta.summary}</div>
              <div className="nav-section-items">
                {items.map(({ route, allowed }) =>
                  allowed ? (
                    <NavLink key={route.path} to={route.path} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                      <span className="nav-link-title">{route.title}</span>
                      <span className="nav-link-summary">{route.summary}</span>
                    </NavLink>
                  ) : (
                    <div key={route.path} className="nav-link disabled" aria-disabled="true">
                      <span className="nav-link-title">{route.title}</span>
                      <span className="nav-link-summary">{route.summary}</span>
                      <span className="nav-lock">Requires additional role</span>
                    </div>
                  )
                )}
              </div>
            </section>
          ))}
        </nav>

        <section className="sidebar-panel">
          <div className="sidebar-panel-label">Always-visible guides</div>
          <div className="stack">
            <div>
              <strong>Evaluator demo guide</strong>
              <p>Fast onboarding for evaluators: setup, simulation, proof, and evidence.</p>
            </div>
            <div>
              <strong>Operator user guide</strong>
              <p>Daily runbook for operators: integrations, workflow run, approval, and audit.</p>
            </div>
          </div>
          <div className="sidebar-actions">
            <Link className="subtle-link" to="/guides">
              Open guides
            </Link>
          </div>
        </section>

        <section className="sidebar-panel compact">
          <div className="sidebar-panel-label">Connected personas</div>
          <div className="persona-row">
            <button
              type="button"
              className={activePersona === "clinician" ? "persona-chip active" : "persona-chip"}
              onClick={() => setActivePersona("clinician")}
            >
              Clinician
            </button>
            <button
              type="button"
              className={activePersona === "security" ? "persona-chip active" : "persona-chip"}
              onClick={() => setActivePersona("security")}
            >
              Security
            </button>
          </div>
          <div className="persona-state">
            <span>{clinicianSession ? "Clinician connected" : "Clinician disconnected"}</span>
            <span>{securitySession ? "Security connected" : "Security disconnected"}</span>
          </div>
          <div className="sidebar-actions">
            {demoIdentitiesEnabled ? (
              <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                {clinicianSession || securitySession ? "Reconnect evaluator identities" : "Connect evaluator identities"}
              </button>
            ) : null}
            <button type="button" className="success" onClick={() => void initializePlatform()} disabled={isSyncing}>
              Initialize platform
            </button>
            <button type="button" onClick={() => void refreshWorkspace()} disabled={isSyncing || !clinicianSession}>
              Refresh live data
            </button>
          </div>
        </section>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <div className="topbar-label">Current route</div>
            <h2>{currentRoute.title}</h2>
            <p>{currentRoute.summary}</p>
          </div>
          <div className="topbar-meta">
            <Badge tone="info">Active: {activePersona}</Badge>
            <Badge tone="default">Mode: {workspaceModeMeta[workspaceMode].label}</Badge>
            <Badge tone={currentRoute.requireStepUpMfa ? "warning" : "success"}>
              {currentRoute.requireStepUpMfa ? "Step-up MFA route" : "Standard route"}
            </Badge>
            <button type="button" onClick={() => setShowTechnicalContext((value) => !value)}>
              {showTechnicalContext ? "Hide technical context" : "Show technical context"}
            </button>
            {lastSyncedAt ? <span className="sync-stamp">Synced {new Date(lastSyncedAt).toLocaleString()}</span> : null}
            <Link className="subtle-link" to="/setup">
              Jump to setup
            </Link>
          </div>
        </div>

        {friendlyError ? (
          <div className="banner error">
            {friendlyError}
            <div className="pill-row">
              <button type="button" className="primary" onClick={() => void initializePlatform()} disabled={isSyncing}>
                Initialize platform
              </button>
              <button type="button" onClick={() => void clearError()} disabled={isSyncing}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        {isSyncing ? <div className="banner info">Refreshing pilot data and evidence chain...</div> : null}
        {!isCurrentRouteInMode ? (
          <div className="banner info">
            This route is outside the selected workspace mode. Switch mode to "All surfaces" to browse the full catalog.
          </div>
        ) : null}

        <PageHeader
          eyebrow={isGuidedRoute ? "OpenAegis Onboarding" : workspaceModeMeta[workspaceMode].label}
          title={isGuidedRoute ? currentRoute.title : PILOT_USE_CASE.title}
          subtitle={
            isGuidedRoute
              ? "Complete setup in order, then move into operations and governance workflows."
              : PILOT_USE_CASE.summary
          }
          actions={
            showTechnicalContext || !isGuidedRoute ? (
              <>
                <Badge tone="info">{PILOT_USE_CASE.workflowId}</Badge>
                <Badge tone="warning">{PILOT_USE_CASE.patientId}</Badge>
                <Badge tone="success">Replayable evidence</Badge>
              </>
            ) : (
              <>
                <Badge tone="info">{PILOT_USE_CASE.tenantId}</Badge>
                <Badge tone="success">Safe-by-default onboarding</Badge>
              </>
            )
          }
        />

        {hasRouteAccess ? (
          <Outlet />
        ) : (
          <EmptyState
            title="Route access denied"
            description={
              needsStepUpAssurance
                ? `The active persona does not have the required assurance level for ${currentRoute.title}. Step up to AAL3, then try again.`
                : `The active persona does not have the required role for ${currentRoute.title}. Switch persona or reconnect sessions.`
            }
            action={
              <div className="pill-row">
                <button type="button" onClick={() => setActivePersona("clinician")}>
                  Use clinician persona
                </button>
                <button type="button" onClick={() => setActivePersona("security")}>
                  Use security persona
                </button>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
};

