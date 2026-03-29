import type { SessionContext, UserRole } from "../shared/auth/session.js";

export interface AppRoute {
  path: string;
  title: string;
  summary: string;
  accent: string;
  requiredRoles: UserRole[];
  requireStepUpMfa?: boolean;
}

export const APP_ROUTES: AppRoute[] = [
  {
    path: "/dashboard",
    title: "Business KPI Dashboard",
    summary: "Executive outcome view for the discharge assistant pilot.",
    accent: "cobalt",
    requiredRoles: ["analyst"]
  },
  {
    path: "/admin",
    title: "Admin Console",
    summary: "Tenant, environment, and release controls for the pilot workspace.",
    accent: "violet",
    requiredRoles: ["platform_admin"]
  },
  {
    path: "/security",
    title: "Security Console",
    summary: "Policy enforcement, route preview, and control-plane posture.",
    accent: "crimson",
    requiredRoles: ["security_admin"]
  },
  {
    path: "/agents",
    title: "Agent Builder",
    summary: "Author the discharge and governance agents with explicit sandbox limits.",
    accent: "teal",
    requiredRoles: ["workflow_operator"]
  },
  {
    path: "/workflows",
    title: "Workflow Designer",
    summary: "Visualize the end-to-end approval-gated discharge flow.",
    accent: "amber",
    requiredRoles: ["workflow_operator"]
  },
  {
    path: "/approvals",
    title: "Approval Inbox",
    summary: "Human review queue for sensitive or live actions.",
    accent: "green",
    requiredRoles: ["approver"],
    requireStepUpMfa: true
  },
  {
    path: "/incidents",
    title: "Incident Review Explorer",
    summary: "Derived incident review from blocked workflows and rejected approvals.",
    accent: "red",
    requiredRoles: ["security_admin", "auditor"],
    requireStepUpMfa: true
  },
  {
    path: "/audit",
    title: "Audit Explorer",
    summary: "Evidence chain, replay artifacts, and operator history.",
    accent: "slate",
    requiredRoles: ["auditor"]
  },
  {
    path: "/simulation",
    title: "Simulation Lab",
    summary: "Practice the discharge workflow before it runs live.",
    accent: "gold",
    requiredRoles: ["workflow_operator"]
  }
];

export const canAccessRoute = (session: SessionContext, route: AppRoute): boolean =>
  route.requiredRoles.every((role) => session.roles.includes(role));
