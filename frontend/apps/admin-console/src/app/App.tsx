import { useEffect, useMemo } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { SessionContext, UserRole } from "../shared/auth/session.js";
import { APP_ROUTES, canAccessRoute } from "./routes.js";
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

export const App = () => {
  const location = useLocation();
  const currentRoute = useMemo(() => {
    return APP_ROUTES.find((route) => route.path === location.pathname) ?? APP_ROUTES[0]!;
  }, [location.pathname]);

  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const activePersona = usePilotWorkspace((state) => state.activePersona);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const error = usePilotWorkspace((state) => state.error);
  const lastSyncedAt = usePilotWorkspace((state) => state.lastSyncedAt);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const refreshWorkspace = usePilotWorkspace((state) => state.refreshWorkspace);
  const boot = usePilotWorkspace((state) => state.boot);
  const setActivePersona = usePilotWorkspace((state) => state.setActivePersona);
  const activeSession = activePersona === "clinician" ? clinicianSession : securitySession;
  const activeContext = useMemo(() => toSessionContext(activeSession), [activeSession]);
  const routeAccess = useMemo(
    () =>
      APP_ROUTES.map((route) => ({
        route,
        allowed: activeContext ? canAccessRoute(activeContext, route) : true
      })),
    [activeContext]
  );
  const hasRouteAccess = activeContext ? canAccessRoute(activeContext, currentRoute) : true;

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EAOS</div>
          <div>
            <div className="brand-name">Enterprise Agent OS</div>
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

        <nav className="sidebar-nav" aria-label="EAOS sections">
          {routeAccess.map(({ route, allowed }) =>
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
        </nav>

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
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {clinicianSession || securitySession ? "Reconnect demo sessions" : "Connect demo sessions"}
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
            <Badge tone={currentRoute.requireStepUpMfa ? "warning" : "success"}>
              {currentRoute.requireStepUpMfa ? "Step-up MFA route" : "Standard route"}
            </Badge>
            {lastSyncedAt ? <span className="sync-stamp">Synced {new Date(lastSyncedAt).toLocaleString()}</span> : null}
            <Link className="subtle-link" to="/dashboard">
              Jump to dashboard
            </Link>
          </div>
        </div>

        {error ? <div className="banner error">Sync error: {error}</div> : null}
        {isSyncing ? <div className="banner info">Refreshing pilot data and evidence chain...</div> : null}

        <PageHeader
          eyebrow="EAOS Pilot Console"
          title={PILOT_USE_CASE.title}
          subtitle={PILOT_USE_CASE.summary}
          actions={
            <>
              <Badge tone="info">{PILOT_USE_CASE.workflowId}</Badge>
              <Badge tone="warning">{PILOT_USE_CASE.patientId}</Badge>
              <Badge tone="success">Replayable evidence</Badge>
            </>
          }
        />

        {hasRouteAccess ? (
          <Outlet />
        ) : (
          <EmptyState
            title="Route access denied"
            description={`The active persona does not have the required role for ${currentRoute.title}. Switch persona or reconnect sessions.`}
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
