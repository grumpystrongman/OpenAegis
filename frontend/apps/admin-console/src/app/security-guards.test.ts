import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_ROUTES } from "./routes.js";
import {
  buildPolicyDraftHash,
  canAccessRouteWithAssurance,
  hasFreshPreviewHash,
  isDemoIdentitiesEnabled
} from "./security-guards.js";
import type { SessionContext } from "../shared/auth/session.js";

const securitySession: SessionContext = {
  userId: "user-security",
  tenantId: "tenant-starlight-health",
  roles: ["security_admin", "approver", "auditor"],
  assuranceLevel: "aal3"
};

const analystSession: SessionContext = {
  userId: "user-analyst",
  tenantId: "tenant-starlight-health",
  roles: ["analyst"],
  assuranceLevel: "aal2"
};

const privilegedAal2Session: SessionContext = {
  userId: "user-privileged-aal2",
  tenantId: "tenant-starlight-health",
  roles: ["platform_admin", "security_admin"],
  assuranceLevel: "aal2"
};

const crossTenantPrivilegedSession: SessionContext = {
  userId: "user-foreign-admin",
  tenantId: "tenant-other-hospital",
  roles: ["platform_admin", "security_admin"],
  assuranceLevel: "aal3"
};

test("demo identities are disabled by default unless the build flag is set", () => {
  const flagHost = globalThis as typeof globalThis & { __ENABLE_DEMO_IDENTITIES__?: boolean };
  const previous = flagHost.__ENABLE_DEMO_IDENTITIES__;
  try {
    delete flagHost.__ENABLE_DEMO_IDENTITIES__;
    assert.equal(isDemoIdentitiesEnabled(), false);

    flagHost.__ENABLE_DEMO_IDENTITIES__ = true;
    assert.equal(isDemoIdentitiesEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete flagHost.__ENABLE_DEMO_IDENTITIES__;
    } else {
      flagHost.__ENABLE_DEMO_IDENTITIES__ = previous;
    }
  }
});

test("governance routes should demand AAL3 step-up instead of exposing admin surfaces at AAL2", () => {
  const sensitiveRoutes = ["/security", "/identity", "/admin"];
  const routeByPath = (path: string): (typeof APP_ROUTES)[number] => {
    const route = APP_ROUTES.find((entry) => entry.path === path);
    if (!route) {
      throw new Error(`Missing route ${path}`);
    }
    return route;
  };
  const routeCatalog = sensitiveRoutes.map(routeByPath);

  assert.deepEqual(
    routeCatalog.map((route) => route.requireStepUpMfa),
    [true, true, true],
    "Governance routes should be marked as step-up routes in the catalog"
  );

  for (const route of routeCatalog) {
    assert.equal(
      canAccessRouteWithAssurance(privilegedAal2Session, route),
      false,
      `Expected ${route.path} to require step-up MFA for AAL2 privileged sessions`
    );
    assert.equal(
      canAccessRouteWithAssurance(securitySession, route),
      true,
      `Expected ${route.path} to remain available to same-tenant AAL3 governance sessions`
    );
  }
});

test("governance routes should be tenant-scoped instead of trusting cross-tenant privileged sessions", () => {
  const sensitiveRoutes = ["/security", "/identity", "/admin"];
  const routeByPath = (path: string): (typeof APP_ROUTES)[number] => {
    const route = APP_ROUTES.find((entry) => entry.path === path);
    if (!route) {
      throw new Error(`Missing route ${path}`);
    }
    return route;
  };

  const actualAccess = sensitiveRoutes.map((path) =>
    canAccessRouteWithAssurance(crossTenantPrivilegedSession, routeByPath(path))
  );

  assert.deepEqual(actualAccess, [false, false, false]);

  const auditRoute = routeByPath("/audit");
  assert.equal(canAccessRouteWithAssurance(crossTenantPrivilegedSession, auditRoute), false);
});

test("step-up routes require AAL3 assurance in the UI guard", () => {
  const approvalsRoute = APP_ROUTES.find((route) => route.path === "/approvals");
  const incidentsRoute = APP_ROUTES.find((route) => route.path === "/incidents");

  assert.ok(approvalsRoute);
  assert.ok(incidentsRoute);
  if (!approvalsRoute || !incidentsRoute) return;

  assert.equal(canAccessRouteWithAssurance(analystSession, approvalsRoute), false);
  assert.equal(canAccessRouteWithAssurance(securitySession, approvalsRoute), true);
  assert.equal(canAccessRouteWithAssurance(securitySession, incidentsRoute), true);
});

test("policy preview hashes gate apply until the current draft is previewed", () => {
  const draft = {
    enforceSecretDeny: true,
    requireZeroRetentionForPhi: true,
    requireApprovalForHighRiskLive: true,
    requireDlpOnOutbound: true,
    restrictExternalProvidersToZeroRetention: true,
    maxToolCallsPerExecution: 8
  };

  const previewHash = buildPolicyDraftHash("Hospital Safe Baseline", draft);
  assert.equal(hasFreshPreviewHash(previewHash, "Hospital Safe Baseline", draft), true);
  assert.equal(
    hasFreshPreviewHash(previewHash, "Hospital Safe Baseline", { ...draft, maxToolCallsPerExecution: 9 }),
    false
  );
});
