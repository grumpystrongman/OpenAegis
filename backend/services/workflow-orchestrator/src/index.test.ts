import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3916;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/workflow-orchestrator-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

const operatorHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-clinician",
  "x-roles": "workflow_operator,analyst",
  "x-mtls-client-san": "spiffe://eaos/clinician"
};

const adminHeaders = {
  ...operatorHeaders,
  "x-actor-id": "user-security",
  "x-roles": "security_admin,platform_admin"
};

test("health exposes workflow metrics", async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { service: string; totalWorkflows: number; totalExecutions: number };
  assert.equal(body.service, "workflow-orchestrator");
  assert.equal(body.totalWorkflows, 2);
  assert.equal(body.totalExecutions, 0);
});

test("creates, starts, checkpoints, and completes an execution", async () => {
  const create = await fetch(`${baseUrl}/v1/executions`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({
      workflowId: "wf-discharge-assistant",
      mode: "live"
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { executionId: string; state: string; stepBudgetRemaining: number };
  assert.equal(created.state, "queued");
  assert.equal(created.stepBudgetRemaining, 12);

  const start = await fetch(`${baseUrl}/v1/executions/${created.executionId}/start`, {
    method: "POST",
    headers: operatorHeaders
  });
  assert.equal(start.status, 200);

  const checkpoint = await fetch(`${baseUrl}/v1/executions/${created.executionId}/checkpoints`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({ note: "fhir-read-complete" })
  });
  assert.equal(checkpoint.status, 200);
  const checkpointBody = (await checkpoint.json()) as { checkpoints: Array<{ stepNumber: number }>; state: string };
  assert.equal(checkpointBody.checkpoints.length, 1);
  assert.equal(checkpointBody.checkpoints[0]?.stepNumber, 1);

  const complete = await fetch(`${baseUrl}/v1/executions/${created.executionId}/complete`, {
    method: "POST",
    headers: operatorHeaders
  });
  assert.equal(complete.status, 200);
  const completeBody = (await complete.json()) as { state: string; completedAt: string };
  assert.equal(completeBody.state, "completed");
  assert.ok(completeBody.completedAt.length > 0);

  const fetchExecution = await fetch(`${baseUrl}/v1/executions/${created.executionId}`, { headers: operatorHeaders });
  assert.equal(fetchExecution.status, 200);
  const execution = (await fetchExecution.json()) as { state: string; checkpoints: Array<{ note: string }> };
  assert.equal(execution.state, "completed");
  assert.equal(execution.checkpoints[0]?.note, "fhir-read-complete");
});

test("blocks admin-only actions without role and returns 404 for missing execution", async () => {
  const denied = await fetch(`${baseUrl}/v1/workflows`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({
      workflowId: "wf-new",
      name: "New Workflow"
    })
  });
  assert.equal(denied.status, 403);

  const missing = await fetch(`${baseUrl}/v1/executions/ex-missing`, { headers: operatorHeaders });
  assert.equal(missing.status, 404);

  const killDenied = await fetch(`${baseUrl}/v1/executions/ex-missing/kill`, {
    method: "POST",
    headers: operatorHeaders
  });
  assert.equal(killDenied.status, 403);
});

test("admin can register a new workflow", async () => {
  const create = await fetch(`${baseUrl}/v1/workflows`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      workflowId: "wf-billing-audit",
      name: "Billing Audit",
      description: "Review billing anomalies.",
      allowedRoles: ["workflow_operator"],
      stepBudget: 5,
      tokenBudget: 1200,
      maxRuntimeSeconds: 20,
      status: "draft",
      version: "0.1.0"
    })
  });
  assert.equal(create.status, 201);

  const list = await fetch(`${baseUrl}/v1/workflows`, { headers: operatorHeaders });
  const body = (await list.json()) as { workflows: Array<{ workflowId: string }> };
  assert.ok(body.workflows.some((workflow) => workflow.workflowId === "wf-billing-audit"));
});

