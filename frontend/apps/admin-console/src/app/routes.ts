import type { SessionContext, UserRole } from "../shared/auth/session.js";

export interface AppRoute {
  path: string;
  title: string;
  summary: string;
  accent: string;
  section: "foundation" | "operate" | "govern";
  requiredRoles: UserRole[];
  match?: "all" | "any";
  requireStepUpMfa?: boolean;
}

export const APP_ROUTES: AppRoute[] = [
  {
    path: "/setup",
    title: "Setup Center",
    summary: "Guided startup, sample loading, and readiness checks for evaluators.",
    accent: "sky",
    section: "foundation",
    requiredRoles: []
  },
  {
    path: "/dashboard",
    title: "Business KPI Dashboard",
    summary: "Executive outcome view for the discharge assistant pilot.",
    accent: "cobalt",
    section: "foundation",
    requiredRoles: ["analyst", "security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/commercial",
    title: "Commercial Readiness",
    summary: "Live claim verification, buyer-facing value mapping, and proof status.",
    accent: "indigo",
    section: "foundation",
    requiredRoles: ["security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/projects",
    title: "Project Packs",
    summary: "Run five end-to-end commercial scenarios with controls and evidence.",
    accent: "teal",
    section: "foundation",
    requiredRoles: ["workflow_operator", "analyst", "security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/project-guide",
    title: "Project Guide",
    summary: "Step-by-step setup, policy, approvals, scenarios, and persona dashboards for one pack.",
    accent: "teal",
    section: "foundation",
    requiredRoles: ["workflow_operator", "analyst", "security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/integrations",
    title: "Integration Hub",
    summary: "Configure and verify Databricks, Fabric, Snowflake, and AWS connectors.",
    accent: "azure",
    section: "foundation",
    requiredRoles: ["security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/identity",
    title: "Identity & Access",
    summary: "User administration, role assignment, and assurance posture.",
    accent: "slate",
    section: "govern",
    requiredRoles: ["security_admin", "platform_admin"],
    match: "any",
    requireStepUpMfa: true
  },
  {
    path: "/admin",
    title: "Admin Console",
    summary: "Tenant, environment, and release controls for the pilot workspace.",
    accent: "violet",
    section: "govern",
    requiredRoles: ["platform_admin", "security_admin"],
    match: "any",
    requireStepUpMfa: true
  },
  {
    path: "/security",
    title: "Security Console",
    summary: "Policy enforcement, route preview, and control-plane posture.",
    accent: "crimson",
    section: "govern",
    requiredRoles: ["security_admin", "platform_admin"],
    match: "any",
    requireStepUpMfa: true
  },
  {
    path: "/agents",
    title: "Agent Builder",
    summary: "Author the discharge and governance agents with explicit sandbox limits.",
    accent: "teal",
    section: "operate",
    requiredRoles: ["workflow_operator", "platform_admin"],
    match: "any"
  },
  {
    path: "/workflows",
    title: "Workflow Designer",
    summary: "Visualize the end-to-end approval-gated discharge flow.",
    accent: "amber",
    section: "operate",
    requiredRoles: ["workflow_operator", "platform_admin"],
    match: "any"
  },
  {
    path: "/approvals",
    title: "Approval Inbox",
    summary: "Human review queue for sensitive or live actions.",
    accent: "green",
    section: "operate",
    requiredRoles: ["approver", "security_admin"],
    match: "any",
    requireStepUpMfa: true
  },
  {
    path: "/incidents",
    title: "Incident Review Explorer",
    summary: "Derived incident review from blocked workflows and rejected approvals.",
    accent: "red",
    section: "govern",
    requiredRoles: ["security_admin", "auditor"],
    match: "any",
    requireStepUpMfa: true
  },
  {
    path: "/audit",
    title: "Audit Explorer",
    summary: "Evidence chain, replay artifacts, and operator history.",
    accent: "slate",
    section: "govern",
    requiredRoles: ["auditor", "security_admin", "platform_admin"],
    match: "any"
  },
  {
    path: "/simulation",
    title: "Simulation Lab",
    summary: "Practice the discharge workflow before it runs live.",
    accent: "gold",
    section: "operate",
    requiredRoles: ["workflow_operator", "platform_admin"],
    match: "any"
  }
];

export const canAccessRoute = (session: SessionContext, route: AppRoute): boolean =>
  route.requiredRoles.length === 0
    ? true
    : route.match === "all"
      ? route.requiredRoles.every((role) => session.roles.includes(role))
      : route.requiredRoles.some((role) => session.roles.includes(role));
