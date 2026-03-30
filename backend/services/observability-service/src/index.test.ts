import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3917;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/observability-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("ingests envelopes, creates incident, and serves trace/incident/health queries", async () => {
  const denied = await fetch(`${baseUrl}/v1/observability/envelopes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-operator",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      kind: "trace",
      traceId: "trace-001",
      operation: "planner"
    })
  });
  assert.equal(denied.status, 403);

  const traceIngest = await fetch(`${baseUrl}/v1/observability/envelopes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "svc-orchestrator",
      "x-roles": "observability_ingest"
    },
    body: JSON.stringify({
      kind: "trace",
      severity: "warning",
      traceId: "trace-001",
      serviceName: "workflow-orchestrator",
      workflowId: "wf-discharge-assistant",
      operation: "planner",
      spanId: "span-1",
      durationMs: 38
    })
  });
  assert.equal(traceIngest.status, 201);

  const logIngest = await fetch(`${baseUrl}/v1/observability/envelopes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "svc-orchestrator",
      "x-roles": "observability_ingest"
    },
    body: JSON.stringify({
      kind: "log",
      severity: "critical",
      traceId: "trace-001",
      serviceName: "workflow-orchestrator",
      workflowId: "wf-discharge-assistant",
      message: "review stage failed compliance gate"
    })
  });
  assert.equal(logIngest.status, 201);
  const logBody = (await logIngest.json()) as { incident?: { incidentId: string; severity: string } };
  assert.ok(logBody.incident?.incidentId);
  assert.equal(logBody.incident?.severity, "critical");

  const traces = await fetch(`${baseUrl}/v1/observability/traces?severity=critical`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-analyst",
      "x-roles": "analyst"
    }
  });
  assert.equal(traces.status, 200);
  const tracesBody = (await traces.json()) as {
    traces: Array<{ traceId: string; maxSeverity: string; envelopeCount: number }>;
  };
  assert.equal(tracesBody.traces.length, 1);
  assert.equal(tracesBody.traces[0]!.traceId, "trace-001");
  assert.equal(tracesBody.traces[0]!.maxSeverity, "critical");
  assert.equal(tracesBody.traces[0]!.envelopeCount, 2);

  const incidents = await fetch(`${baseUrl}/v1/observability/incidents?severity=critical`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "security_admin"
    }
  });
  assert.equal(incidents.status, 200);
  const incidentBody = (await incidents.json()) as {
    incidents: Array<{ severity: string; status: string; envelopeIds: string[] }>;
  };
  assert.equal(incidentBody.incidents.length, 1);
  assert.equal(incidentBody.incidents[0]!.severity, "critical");
  assert.equal(incidentBody.incidents[0]!.status, "open");
  assert.equal(incidentBody.incidents[0]!.envelopeIds.length, 1);

  const health = await fetch(`${baseUrl}/v1/observability/metrics/health`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-analyst",
      "x-roles": "analyst"
    }
  });
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as {
    totals: { envelopes: number; openIncidents: number };
    byKind: { trace: number; log: number };
    integrity: { valid: boolean };
  };
  assert.equal(healthBody.totals.envelopes, 2);
  assert.equal(healthBody.totals.openIncidents, 1);
  assert.equal(healthBody.byKind.trace, 1);
  assert.equal(healthBody.byKind.log, 1);
  assert.equal(healthBody.integrity.valid, true);
});

test("cross-tenant observability queries require platform admin", async () => {
  const ingest = await fetch(`${baseUrl}/v1/observability/envelopes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-river-hospital",
      "x-actor-id": "svc-river",
      "x-roles": "observability_ingest"
    },
    body: JSON.stringify({
      kind: "trace",
      severity: "info",
      traceId: "trace-river-01",
      serviceName: "model-broker",
      operation: "route"
    })
  });
  assert.equal(ingest.status, 201);

  const denied = await fetch(`${baseUrl}/v1/observability/traces?tenantId=tenant-river-hospital`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-analyst",
      "x-roles": "analyst"
    }
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${baseUrl}/v1/observability/traces?tenantId=tenant-river-hospital`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-platform-admin",
      "x-roles": "platform_admin"
    }
  });
  assert.equal(allowed.status, 200);
  const body = (await allowed.json()) as { traces: Array<{ traceId: string }> };
  assert.equal(body.traces.length, 1);
  assert.equal(body.traces[0]!.traceId, "trace-river-01");
});
