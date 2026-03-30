import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3916;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/kill-switch-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("security admin can trigger and release scoped circuit, with immutable events", async () => {
  const deniedTrigger = await fetch(`${baseUrl}/v1/kill-switch/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-clinician",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({ workflowId: "wf-discharge-assistant", reason: "unsafe run detected" })
  });
  assert.equal(deniedTrigger.status, 403);

  const trigger = await fetch(`${baseUrl}/v1/kill-switch/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "security_admin"
    },
    body: JSON.stringify({
      workflowId: "wf-discharge-assistant",
      serviceName: "model-broker",
      severity: "critical",
      reason: "provider routing anomaly"
    })
  });
  assert.equal(trigger.status, 201);
  const triggered = (await trigger.json()) as {
    circuit: { circuitId: string; status: string; scope: { workflowId?: string }; severity: string };
  };
  assert.equal(triggered.circuit.status, "triggered");
  assert.equal(triggered.circuit.severity, "critical");
  assert.equal(triggered.circuit.scope.workflowId, "wf-discharge-assistant");

  const status = await fetch(
    `${baseUrl}/v1/kill-switch/status?workflowId=wf-discharge-assistant&serviceName=model-broker`,
    {
      headers: {
        "x-tenant-id": "tenant-starlight-health",
        "x-actor-id": "user-operator",
        "x-roles": "workflow_operator"
      }
    }
  );
  assert.equal(status.status, 200);
  const statusBody = (await status.json()) as {
    circuits: Array<{ circuitId: string; status: string }>;
    totals: { active: number };
  };
  assert.equal(statusBody.circuits.length, 1);
  assert.equal(statusBody.circuits[0]!.circuitId, triggered.circuit.circuitId);
  assert.equal(statusBody.totals.active, 1);

  const release = await fetch(`${baseUrl}/v1/kill-switch/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "security_admin"
    },
    body: JSON.stringify({
      circuitId: triggered.circuit.circuitId,
      reason: "incident mitigated"
    })
  });
  assert.equal(release.status, 200);
  const released = (await release.json()) as { circuit: { status: string; releasedBy?: string } };
  assert.equal(released.circuit.status, "released");
  assert.equal(released.circuit.releasedBy, "user-security");

  const events = await fetch(`${baseUrl}/v1/kill-switch/events`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-auditor",
      "x-roles": "auditor"
    }
  });
  assert.equal(events.status, 200);
  const eventsBody = (await events.json()) as {
    events: Array<{ eventType: string }>;
    chainVerification: { valid: boolean };
  };
  assert.equal(eventsBody.events.length, 2);
  assert.deepEqual(eventsBody.events.map((event) => event.eventType).sort(), ["RELEASED", "TRIGGERED"]);
  assert.equal(eventsBody.chainVerification.valid, true);
});

test("cross-tenant scoped operations require platform admin", async () => {
  const denied = await fetch(`${baseUrl}/v1/kill-switch/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "security_admin"
    },
    body: JSON.stringify({
      tenantId: "tenant-river-hospital",
      workflowId: "wf-icu-discharge",
      reason: "manual emergency stop"
    })
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${baseUrl}/v1/kill-switch/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-platform-admin",
      "x-roles": "platform_admin"
    },
    body: JSON.stringify({
      tenantId: "tenant-river-hospital",
      workflowId: "wf-icu-discharge",
      reason: "manual emergency stop"
    })
  });
  assert.equal(allowed.status, 201);

  const deniedStatus = await fetch(`${baseUrl}/v1/kill-switch/status?tenantId=tenant-river-hospital`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-auditor",
      "x-roles": "auditor"
    }
  });
  assert.equal(deniedStatus.status, 403);

  const adminStatus = await fetch(`${baseUrl}/v1/kill-switch/status?tenantId=tenant-river-hospital`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-platform-admin",
      "x-roles": "platform_admin"
    }
  });
  assert.equal(adminStatus.status, 200);
  const body = (await adminStatus.json()) as { circuits: Array<{ scope: { tenantId: string } }> };
  assert.equal(body.circuits.length, 1);
  assert.equal(body.circuits[0]!.scope.tenantId, "tenant-river-hospital");
});
