import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3921;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/model-broker-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("evaluates model route and persists tenant decision history", async () => {
  const capabilityResponse = await fetch(`${baseUrl}/v1/model-broker/providers/capabilities`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-clinician",
      "x-roles": "workflow_operator"
    }
  });
  assert.equal(capabilityResponse.status, 200);
  const capabilitiesBody = (await capabilityResponse.json()) as { providers: unknown[] };
  assert.ok(capabilitiesBody.providers.length >= 1);

  const evaluateResponse = await fetch(`${baseUrl}/v1/model-broker/routes/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-clinician",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      sensitivity: "EPHI",
      requiredCapabilities: ["json_schema", "tool_use"],
      zeroRetentionRequired: true,
      maxLatencyMs: 3000,
      costCeiling: "high"
    })
  });
  assert.equal(evaluateResponse.status, 200);
  const evaluateBody = (await evaluateResponse.json()) as {
    decisionId: string;
    selected: { provider: string; supportsZeroRetention: boolean };
  };
  assert.ok(evaluateBody.decisionId.startsWith("route-"));
  assert.equal(evaluateBody.selected.supportsZeroRetention, true);

  const decisionsResponse = await fetch(`${baseUrl}/v1/model-broker/routes/decisions`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "auditor"
    }
  });
  assert.equal(decisionsResponse.status, 200);
  const decisionsBody = (await decisionsResponse.json()) as { decisions: Array<{ decisionId: string }> };
  assert.equal(decisionsBody.decisions.length, 1);
  assert.equal(decisionsBody.decisions[0]?.decisionId, evaluateBody.decisionId);
});

test("denies route evaluation without actor context", async () => {
  const response = await fetch(`${baseUrl}/v1/model-broker/routes/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      sensitivity: "PUBLIC",
      requiredCapabilities: ["json_schema"],
      zeroRetentionRequired: false,
      maxLatencyMs: 2000
    })
  });

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "actor_context_required");
});
