import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.js";

const baseUrl = "http://127.0.0.1:3907";
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/tool-execution-state.json", { force: true });
  server = createAppServer();
  server.listen(3907);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("allows simulated connector execution", async () => {
  const response = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": "user-clinician",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "clinician"
    },
    body: JSON.stringify({
      toolId: "connector-fhir-read",
      action: "READ",
      mode: "simulate",
      requestedNetworkProfile: "clinical-internal",
      stepBudgetRemaining: 2
    })
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; result: { operation: string } };
  assert.equal(body.status, "completed");
  assert.equal(body.result.operation, "mock_execution");
});

test("blocks execution when approval is required and missing", async () => {
  const response = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": "user-workflow",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "workflow_operator",
      "idempotency-key": "idem-approval-missing-001"
    },
    body: JSON.stringify({
      toolId: "connector-email-notify",
      action: "EXECUTE",
      mode: "execute",
      requestedNetworkProfile: "outbound-approved",
      stepBudgetRemaining: 1,
      requiresApproval: true,
      approvalGranted: false
    })
  });

  assert.equal(response.status, 403);
  const body = (await response.json()) as { status: string; guardReason: string };
  assert.equal(body.status, "blocked");
  assert.equal(body.guardReason, "approval_missing");
});

test("replays idempotent calls for matching idempotency key", async () => {
  const headers = {
    "content-type": "application/json",
    "x-actor-id": "user-security",
    "x-tenant-id": "tenant-starlight-health",
    "x-roles": "security_admin",
    "idempotency-key": "idem-linear-001"
  };

  const body = {
    toolId: "connector-linear-project",
    action: "EXECUTE",
    mode: "simulate",
    requestedNetworkProfile: "project-ops",
    stepBudgetRemaining: 3,
    parameters: { project: "OpenAegis Commercial Ship" }
  };

  const first = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { toolCallId: string; idempotentReplay?: boolean };
  assert.equal(firstBody.idempotentReplay, undefined);

  const second = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as { toolCallId: string; idempotentReplay?: boolean };
  assert.equal(secondBody.toolCallId, firstBody.toolCallId);
  assert.equal(secondBody.idempotentReplay, true);
});

test("rejects live execute without idempotency key", async () => {
  const response = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": "user-workflow",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      toolId: "connector-linear-project",
      action: "EXECUTE",
      mode: "execute",
      requestedNetworkProfile: "project-ops",
      stepBudgetRemaining: 2,
      parameters: { project: "prod-rollout" }
    })
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "idempotency_key_required_for_live_execute");
});

test("rejects idempotency key reuse with mismatched payload", async () => {
  const headers = {
    "content-type": "application/json",
    "x-actor-id": "user-security",
    "x-tenant-id": "tenant-starlight-health",
    "x-roles": "security_admin",
    "idempotency-key": "idem-linear-mismatch"
  };

  const first = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolId: "connector-linear-project",
      action: "EXECUTE",
      mode: "simulate",
      requestedNetworkProfile: "project-ops",
      stepBudgetRemaining: 3,
      parameters: { project: "OpenAegis A" }
    })
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolId: "connector-linear-project",
      action: "EXECUTE",
      mode: "simulate",
      requestedNetworkProfile: "project-ops",
      stepBudgetRemaining: 3,
      parameters: { project: "OpenAegis B" }
    })
  });
  assert.equal(second.status, 409);
  const body = (await second.json()) as { error: string };
  assert.equal(body.error, "idempotency_key_reuse_mismatch");
});

test("enforces tenant-scoped visibility for non-platform users", async () => {
  const create = await fetch(`${baseUrl}/v1/tool-calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": "user-workflow",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      toolId: "connector-fhir-read",
      action: "READ",
      mode: "simulate",
      requestedNetworkProfile: "clinical-internal",
      stepBudgetRemaining: 2
    })
  });
  assert.equal(create.status, 200);
  const created = (await create.json()) as { toolCallId: string };

  const crossTenantGet = await fetch(`${baseUrl}/v1/tool-calls/${created.toolCallId}`, {
    headers: {
      "x-actor-id": "user-tenant-other",
      "x-tenant-id": "tenant-other-health",
      "x-roles": "security_admin"
    }
  });
  assert.equal(crossTenantGet.status, 404);
});

