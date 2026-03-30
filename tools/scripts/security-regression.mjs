#!/usr/bin/env node
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAppServer as createGatewayServer } from "../../dist/services/api-gateway/src/index.js";
import { createAppServer as createAuthServer } from "../../dist/services/auth-service/src/index.js";
import { createAppServer as createToolExecutionServer } from "../../dist/services/tool-execution-service/src/index.js";

const ports = {
  gateway: Number(process.env.OPENAEGIS_SECURITY_GATEWAY_PORT ?? 3970),
  auth: Number(process.env.OPENAEGIS_SECURITY_AUTH_PORT ?? 3971),
  toolExecution: Number(process.env.OPENAEGIS_SECURITY_TOOL_EXECUTION_PORT ?? 3972)
};

const baseUrls = {
  gateway: `http://127.0.0.1:${ports.gateway}`,
  auth: `http://127.0.0.1:${ports.auth}`,
  toolExecution: `http://127.0.0.1:${ports.toolExecution}`
};

const call = async (baseUrl, path, method = "GET", options = {}) => {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.status,
    payload
  };
};

const callTimed = async (baseUrl, path, method = "GET", options = {}) => {
  const startedAt = Date.now();
  const result = await call(baseUrl, path, method, options);
  return {
    ...result,
    elapsedMs: Date.now() - startedAt
  };
};

const normalizeError = (payload) => (typeof payload?.error === "string" ? payload.error : "none");

export const runSecurityRegression = async () => {
  const envBackup = {
    OPENAEGIS_REQUIRE_INTROSPECTION: process.env.OPENAEGIS_REQUIRE_INTROSPECTION,
    OPENAEGIS_AUTH_INTROSPECTION_URL: process.env.OPENAEGIS_AUTH_INTROSPECTION_URL,
    OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID: process.env.OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID,
    OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID: process.env.OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID,
    OPENAEGIS_AUTH_ISSUER: process.env.OPENAEGIS_AUTH_ISSUER,
    OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH: process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH
  };

  process.env.OPENAEGIS_REQUIRE_INTROSPECTION = "true";
  process.env.OPENAEGIS_AUTH_INTROSPECTION_URL = `${baseUrls.auth}/v1/auth/introspect`;
  process.env.OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID = "service-gateway";
  process.env.OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID = "tenant-platform";
  process.env.OPENAEGIS_AUTH_ISSUER = baseUrls.auth;
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "false";

  const servers = {
    auth: createAuthServer(),
    gateway: createGatewayServer(),
    toolExecution: createToolExecutionServer()
  };

  servers.auth.listen(ports.auth);
  servers.gateway.listen(ports.gateway);
  servers.toolExecution.listen(ports.toolExecution);
  await Promise.all([once(servers.auth, "listening"), once(servers.gateway, "listening"), once(servers.toolExecution, "listening")]);

  const checks = [];

  try {
    const demoLoginDisabled = await callTimed(baseUrls.gateway, "/v1/auth/login", "POST", {
      body: { email: "clinician@starlighthealth.org" }
    });
    checks.push({
      checkId: "demo_login_disabled_by_default",
      passed: demoLoginDisabled.status === 404 && normalizeError(demoLoginDisabled.payload) === "demo_auth_disabled",
      details: {
        status: demoLoginDisabled.status,
        error: normalizeError(demoLoginDisabled.payload),
        latencyMs: demoLoginDisabled.elapsedMs
      }
    });

    const demoTokenDenied = await callTimed(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: "Bearer demo-token-user-security" },
      body: {
        tenantId: "tenant-starlight-health",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        mode: "simulation"
      }
    });
    checks.push({
      checkId: "demo_token_denied_when_introspection_required",
      passed: demoTokenDenied.status === 401 && normalizeError(demoTokenDenied.payload) === "missing_or_invalid_auth_token",
      details: {
        status: demoTokenDenied.status,
        error: normalizeError(demoTokenDenied.payload),
        latencyMs: demoTokenDenied.elapsedMs
      }
    });

    const clinicianToken = await callTimed(baseUrls.auth, "/v1/auth/token", "POST", {
      body: { email: "clinician@starlighthealth.org" }
    });
    const securityToken = await callTimed(baseUrls.auth, "/v1/auth/token", "POST", {
      body: { email: "security@starlighthealth.org" }
    });

    checks.push({
      checkId: "auth_service_issues_introspectable_tokens",
      passed: clinicianToken.status === 200 && securityToken.status === 200,
      details: {
        clinicianStatus: clinicianToken.status,
        securityStatus: securityToken.status,
        clinicianSubject: clinicianToken.payload.subject,
        securitySubject: securityToken.payload.subject
      }
    });

    const clinicianAccessToken =
      typeof clinicianToken.payload.accessToken === "string" ? clinicianToken.payload.accessToken : "";
    const securityAccessToken = typeof securityToken.payload.accessToken === "string" ? securityToken.payload.accessToken : "";

    const sameTenantExecution = await callTimed(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: `Bearer ${clinicianAccessToken}` },
      body: {
        tenantId: "tenant-starlight-health",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        mode: "simulation"
      }
    });
    checks.push({
      checkId: "introspected_token_allows_same_tenant_execution",
      passed: sameTenantExecution.status === 201 && typeof sameTenantExecution.payload.executionId === "string",
      details: {
        status: sameTenantExecution.status,
        executionId: sameTenantExecution.payload.executionId,
        latencyMs: sameTenantExecution.elapsedMs
      }
    });

    const crossTenantExecution = await callTimed(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: `Bearer ${clinicianAccessToken}` },
      body: {
        tenantId: "tenant-other-health",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-2001",
        mode: "simulation"
      }
    });
    checks.push({
      checkId: "cross_tenant_write_blocked",
      passed: crossTenantExecution.status === 403 && normalizeError(crossTenantExecution.payload) === "tenant_scope_mismatch",
      details: {
        status: crossTenantExecution.status,
        error: normalizeError(crossTenantExecution.payload),
        latencyMs: crossTenantExecution.elapsedMs
      }
    });

    const liveExecution = await callTimed(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: `Bearer ${clinicianAccessToken}` },
      body: {
        tenantId: "tenant-starlight-health",
        mode: "live",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-1001",
        requestFollowupEmail: true
      }
    });
    const approvalId = typeof liveExecution.payload.approvalId === "string" ? liveExecution.payload.approvalId : "";

    const clinicianDecisionDenied = await callTimed(
      baseUrls.gateway,
      `/v1/approvals/${approvalId}/decide`,
      "POST",
      {
        headers: { authorization: `Bearer ${clinicianAccessToken}` },
        body: { decision: "approve", reason: "malicious self-approval attempt" }
      }
    );
    checks.push({
      checkId: "approval_decision_requires_approver_role",
      passed:
        liveExecution.status === 201 &&
        liveExecution.payload.status === "blocked" &&
        approvalId.length > 0 &&
        clinicianDecisionDenied.status === 403 &&
        normalizeError(clinicianDecisionDenied.payload) === "insufficient_role_for_approval_decision",
      details: {
        executionStatus: liveExecution.status,
        workflowStatus: liveExecution.payload.status,
        approvalId,
        deniedStatus: clinicianDecisionDenied.status,
        deniedError: normalizeError(clinicianDecisionDenied.payload)
      }
    });

    const crossTenantApproverToken = await callTimed(baseUrls.auth, "/v1/auth/token", "POST", {
      body: {
        subject: "user-other-approver",
        tenantId: "tenant-other-health",
        roles: ["approver"]
      }
    });
    const crossTenantApproverAccessToken =
      typeof crossTenantApproverToken.payload.accessToken === "string" ? crossTenantApproverToken.payload.accessToken : "";

    const crossTenantDecisionDenied = await callTimed(
      baseUrls.gateway,
      `/v1/approvals/${approvalId}/decide`,
      "POST",
      {
        headers: { authorization: `Bearer ${crossTenantApproverAccessToken}` },
        body: { decision: "approve", reason: "cross-tenant decision attempt" }
      }
    );
    const securityDecision = await callTimed(baseUrls.gateway, `/v1/approvals/${approvalId}/decide`, "POST", {
      headers: { authorization: `Bearer ${securityAccessToken}` },
      body: { decision: "approve", reason: "authorized security approval" }
    });
    const replayedDecision = await callTimed(baseUrls.gateway, `/v1/approvals/${approvalId}/decide`, "POST", {
      headers: { authorization: `Bearer ${securityAccessToken}` },
      body: { decision: "reject", reason: "replay attempt should fail" }
    });

    checks.push({
      checkId: "approval_decision_enforces_tenant_scope",
      passed:
        crossTenantApproverToken.status === 200 &&
        crossTenantDecisionDenied.status === 403 &&
        normalizeError(crossTenantDecisionDenied.payload) === "tenant_scope_mismatch" &&
        securityDecision.status === 200 &&
        securityDecision.payload.status === "approved" &&
        replayedDecision.status === 409 &&
        normalizeError(replayedDecision.payload) === "approval_already_decided",
      details: {
        crossTenantTokenStatus: crossTenantApproverToken.status,
        crossTenantDeniedStatus: crossTenantDecisionDenied.status,
        crossTenantDeniedError: normalizeError(crossTenantDecisionDenied.payload),
        authorizedDecisionStatus: securityDecision.status,
        authorizedDecisionState: securityDecision.payload.status,
        replayDecisionStatus: replayedDecision.status,
        replayDecisionError: normalizeError(replayedDecision.payload)
      }
    });

    const clinicianApprovalListDenied = await callTimed(baseUrls.gateway, "/v1/approvals", "GET", {
      headers: { authorization: `Bearer ${clinicianAccessToken}` }
    });
    const securityApprovalList = await callTimed(baseUrls.gateway, "/v1/approvals", "GET", {
      headers: { authorization: `Bearer ${securityAccessToken}` }
    });
    checks.push({
      checkId: "approval_list_requires_privileged_roles",
      passed:
        clinicianApprovalListDenied.status === 403 &&
        normalizeError(clinicianApprovalListDenied.payload) === "insufficient_role_for_approval_list" &&
        securityApprovalList.status === 200 &&
        Array.isArray(securityApprovalList.payload.approvals),
      details: {
        clinicianStatus: clinicianApprovalListDenied.status,
        clinicianError: normalizeError(clinicianApprovalListDenied.payload),
        securityStatus: securityApprovalList.status,
        approvalCount: Array.isArray(securityApprovalList.payload.approvals)
          ? securityApprovalList.payload.approvals.length
          : 0
      }
    });

    const toolNoContext = await callTimed(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      body: {
        toolId: "connector-fhir-read",
        action: "READ",
        mode: "simulate",
        requestedNetworkProfile: "clinical-internal",
        stepBudgetRemaining: 1
      }
    });
    checks.push({
      checkId: "tool_execution_requires_tenant_and_actor_context",
      passed: toolNoContext.status === 400 && normalizeError(toolNoContext.payload) === "tenant_context_required",
      details: {
        status: toolNoContext.status,
        error: normalizeError(toolNoContext.payload)
      }
    });

    const toolExecuteWithoutIdem = await callTimed(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: {
        "x-actor-id": "user-security",
        "x-tenant-id": "tenant-starlight-health",
        "x-roles": "security_admin"
      },
      body: {
        toolId: "connector-linear-project",
        action: "EXECUTE",
        mode: "execute",
        requestedNetworkProfile: "project-ops",
        stepBudgetRemaining: 2,
        parameters: {
          project: "OpenAegis Security Regression"
        }
      }
    });
    checks.push({
      checkId: "live_tool_execute_requires_idempotency_key",
      passed:
        toolExecuteWithoutIdem.status === 400 &&
        normalizeError(toolExecuteWithoutIdem.payload) === "idempotency_key_required_for_live_execute",
      details: {
        status: toolExecuteWithoutIdem.status,
        error: normalizeError(toolExecuteWithoutIdem.payload)
      }
    });

    const idemHeaders = {
      "idempotency-key": "security-regression-linear-001",
      "x-actor-id": "user-security",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "security_admin"
    };

    const toolFirst = await callTimed(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: idemHeaders,
      body: {
        toolId: "connector-linear-project",
        action: "EXECUTE",
        mode: "simulate",
        requestedNetworkProfile: "project-ops",
        stepBudgetRemaining: 2,
        parameters: {
          project: "OpenAegis Security Regression A"
        }
      }
    });

    const toolMismatch = await callTimed(baseUrls.toolExecution, "/v1/tool-calls", "POST", {
      headers: idemHeaders,
      body: {
        toolId: "connector-linear-project",
        action: "EXECUTE",
        mode: "simulate",
        requestedNetworkProfile: "project-ops",
        stepBudgetRemaining: 2,
        parameters: {
          project: "OpenAegis Security Regression B"
        }
      }
    });
    checks.push({
      checkId: "tool_idempotency_reuse_mismatch_blocked",
      passed:
        toolFirst.status === 200 &&
        toolMismatch.status === 409 &&
        normalizeError(toolMismatch.payload) === "idempotency_key_reuse_mismatch",
      details: {
        firstStatus: toolFirst.status,
        mismatchStatus: toolMismatch.status,
        mismatchError: normalizeError(toolMismatch.payload)
      }
    });

    const createdToolCallId = typeof toolFirst.payload.toolCallId === "string" ? toolFirst.payload.toolCallId : "";
    const crossTenantLookup = await callTimed(
      baseUrls.toolExecution,
      `/v1/tool-calls/${createdToolCallId}`,
      "GET",
      {
        headers: {
          "x-actor-id": "user-other-security",
          "x-tenant-id": "tenant-other-health",
          "x-roles": "security_admin"
        }
      }
    );
    checks.push({
      checkId: "tool_call_lookup_is_tenant_scoped",
      passed:
        createdToolCallId.length > 0 &&
        crossTenantLookup.status === 404 &&
        normalizeError(crossTenantLookup.payload) === "tool_call_not_found",
      details: {
        createdToolCallId,
        status: crossTenantLookup.status,
        error: normalizeError(crossTenantLookup.payload)
      }
    });

    const policyWithoutBreakGlass = await callTimed(baseUrls.gateway, "/v1/policies/profile/save", "POST", {
      headers: { authorization: `Bearer ${securityAccessToken}` },
      body: {
        tenantId: "tenant-starlight-health",
        profileName: "Security regression draft",
        changeSummary: "Disable secret deny without break-glass",
        controls: {
          enforceSecretDeny: false
        }
      }
    });

    const policyWithBreakGlass = await callTimed(baseUrls.gateway, "/v1/policies/profile/save", "POST", {
      headers: { authorization: `Bearer ${securityAccessToken}` },
      body: {
        tenantId: "tenant-starlight-health",
        profileName: "Security regression draft",
        changeSummary: "Controlled exception for regression drill",
        controls: {
          enforceSecretDeny: false
        },
        breakGlass: {
          ticketId: "SEC-REGRESSION-001",
          justification: "Regression test with temporary exception and rollback plan.",
          approverIds: ["security-lead-1", "compliance-lead-2"]
        }
      }
    });

    checks.push({
      checkId: "break_glass_required_for_blocking_policy_change",
      passed:
        policyWithoutBreakGlass.status === 422 &&
        normalizeError(policyWithoutBreakGlass.payload) === "break_glass_required_for_blocking_policy_changes" &&
        policyWithBreakGlass.status === 200 &&
        policyWithBreakGlass.payload.breakGlassUsed === true,
      details: {
        deniedStatus: policyWithoutBreakGlass.status,
        deniedError: normalizeError(policyWithoutBreakGlass.payload),
        approvedStatus: policyWithBreakGlass.status,
        breakGlassUsed: policyWithBreakGlass.payload.breakGlassUsed === true
      }
    });

    const revokeResponse = await callTimed(baseUrls.auth, "/v1/auth/revoke", "POST", {
      headers: {
        "x-actor-id": "service-gateway",
        "x-tenant-id": "tenant-platform"
      },
      body: { token: clinicianAccessToken }
    });
    const postRevokeExecution = await callTimed(baseUrls.gateway, "/v1/executions", "POST", {
      headers: { authorization: `Bearer ${clinicianAccessToken}` },
      body: {
        tenantId: "tenant-starlight-health",
        workflowId: "wf-discharge-assistant",
        patientId: "patient-3001",
        mode: "simulation"
      }
    });
    checks.push({
      checkId: "revoked_token_denied_via_introspection",
      passed:
        revokeResponse.status === 200 &&
        revokeResponse.payload.revoked === true &&
        postRevokeExecution.status === 401 &&
        normalizeError(postRevokeExecution.payload) === "missing_or_invalid_auth_token",
      details: {
        revokeStatus: revokeResponse.status,
        revoked: revokeResponse.payload.revoked === true,
        gatewayStatus: postRevokeExecution.status,
        gatewayError: normalizeError(postRevokeExecution.payload)
      }
    });
  } finally {
    servers.auth.close();
    servers.gateway.close();
    servers.toolExecution.close();
    await Promise.all([once(servers.auth, "close"), once(servers.gateway, "close"), once(servers.toolExecution, "close")]);

    for (const [key, value] of Object.entries(envBackup)) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }

  const passedChecks = checks.filter((check) => check.passed).length;
  const scorePercent = Number(((passedChecks / Math.max(1, checks.length)) * 100).toFixed(2));
  const report = {
    generatedAt: new Date().toISOString(),
    suite: "security-regression",
    endpoints: baseUrls,
    checks,
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      scorePercent,
      status: checks.every((check) => check.passed) ? "PASS" : "FAIL"
    }
  };

  await mkdir("docs/assets/demo", { recursive: true });
  await writeFile("docs/assets/demo/security-regression-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSecurityRegression()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.summary.status !== "PASS") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
