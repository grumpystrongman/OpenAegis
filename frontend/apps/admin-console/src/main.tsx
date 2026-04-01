import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./app/App.js";
import { ApprovalInboxPage } from "./app/pages/approval-inbox-page.js";
import { AgentBuilderPage } from "./app/pages/agent-builder-page.js";
import { AdminConsolePage } from "./app/pages/admin-console-page.js";
import { AuditExplorerPage } from "./app/pages/audit-explorer-page.js";
import { CommercialReadinessPage } from "./app/pages/commercial-readiness-page.js";
import { DashboardPage } from "./app/pages/dashboard-page.js";
import { IdentityAccessPage } from "./app/pages/identity-access-page.js";
import { IncidentReviewPage } from "./app/pages/incident-review-page.js";
import { IntegrationHubPage } from "./app/pages/integration-hub-page.js";
import { NotFoundPage } from "./app/pages/not-found-page.js";
import { ProjectPackDetailPage } from "./app/pages/project-pack-detail-page.js";
import { ProjectPacksPage } from "./app/pages/project-packs-page.js";
import { SecurityConsolePage } from "./app/pages/security-console-page.js";
import { SetupCenterPage } from "./app/pages/setup-center-page.js";
import { SimulationLabPage } from "./app/pages/simulation-lab-page.js";
import { WorkflowDesignerPage } from "./app/pages/workflow-designer-page.js";
import "./styles.css";

(
  globalThis as typeof globalThis & { __ENABLE_DEMO_IDENTITIES__?: boolean }
).__ENABLE_DEMO_IDENTITIES__ =
  import.meta.env.VITE_ENABLE_DEMO_IDENTITIES === "true";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/setup" replace /> },
      { path: "setup", element: <SetupCenterPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "commercial", element: <CommercialReadinessPage /> },
      { path: "projects", element: <ProjectPacksPage /> },
      { path: "project-guide", element: <ProjectPackDetailPage /> },
      { path: "integrations", element: <IntegrationHubPage /> },
      { path: "identity", element: <IdentityAccessPage /> },
      { path: "admin", element: <AdminConsolePage /> },
      { path: "security", element: <SecurityConsolePage /> },
      { path: "agents", element: <AgentBuilderPage /> },
      { path: "workflows", element: <WorkflowDesignerPage /> },
      { path: "approvals", element: <ApprovalInboxPage /> },
      { path: "incidents", element: <IncidentReviewPage /> },
      { path: "audit", element: <AuditExplorerPage /> },
      { path: "simulation", element: <SimulationLabPage /> },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
