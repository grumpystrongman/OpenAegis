import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3915;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/agent-registry-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

const adminHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,platform_admin",
  "x-mtls-client-san": "spiffe://eaos/security"
};

const operatorHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-clinician",
  "x-roles": "workflow_operator,analyst",
  "x-mtls-client-san": "spiffe://eaos/clinician"
};

test("health exposes registry metrics", async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { service: string; totalAgents: number; activeAgents: number };
  assert.equal(body.service, "agent-registry");
  assert.equal(body.totalAgents, 3);
  assert.equal(body.activeAgents, 2);
});

test("lists tenant agents and blocks create without admin role", async () => {
  const list = await fetch(`${baseUrl}/v1/agents`, { headers: operatorHeaders });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { agents: Array<{ agentId: string }> };
  assert.ok(listBody.agents.some((agent) => agent.agentId === "agent-discharge-planner"));

  const createDenied = await fetch(`${baseUrl}/v1/agents`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({
      agentId: "agent-inventory-triage",
      name: "Inventory Triage",
      description: "Reviews supply issues.",
      owner: "ops",
      toolScopes: ["sql.read"],
      budget: { stepLimit: 5, maxRuntimeSeconds: 10, retryLimit: 0 }
    })
  });
  assert.equal(createDenied.status, 403);
});

test("creates and updates an agent with admin privileges", async () => {
  const create = await fetch(`${baseUrl}/v1/agents`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      agentId: "agent-inventory-triage",
      name: "Inventory Triage",
      description: "Reviews supply issues.",
      owner: "ops",
      sandboxProfile: "read-only",
      toolScopes: ["sql.read"],
      budget: { stepLimit: 5, maxRuntimeSeconds: 10, retryLimit: 0 },
      status: "draft"
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { agentId: string; versions: Array<{ version: string }> };
  assert.equal(created.agentId, "agent-inventory-triage");
  assert.equal(created.versions[0]?.version, "1.0.0");

  const patch = await fetch(`${baseUrl}/v1/agents/agent-inventory-triage`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      status: "active",
      budget: { stepLimit: 7 }
    })
  });
  assert.equal(patch.status, 200);
  const updated = (await patch.json()) as { status: string; versions: Array<{ version: string }> };
  assert.equal(updated.status, "active");
  assert.equal(updated.versions.at(-1)?.version, "2.0.0");
});

test("returns 404 for missing agents", async () => {
  const response = await fetch(`${baseUrl}/v1/agents/missing-agent`, { headers: operatorHeaders });
  assert.equal(response.status, 404);
});

