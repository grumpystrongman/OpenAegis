import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3913;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

const securityHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,auditor"
};

beforeEach(async () => {
  await rm(".volumes/policy-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("evaluates and stores decision records", async () => {
  const evaluate = await fetch(`${baseUrl}/v1/policies/evaluate`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      action: "workflow.execute",
      resource: "patient-discharge",
      dataClasses: ["EPHI"],
      purpose: "discharge",
      mode: "live",
      riskLevel: "high"
    })
  });
  assert.equal(evaluate.status, 200);
  const evalBody = (await evaluate.json()) as { decision: { effect: string } };
  assert.equal(evalBody.decision.effect, "REQUIRE_APPROVAL");

  const list = await fetch(`${baseUrl}/v1/policies/decisions`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "auditor"
    }
  });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { decisions: unknown[] };
  assert.ok(listBody.decisions.length >= 1);
});

test("security admin can publish new policy bundle versions", async () => {
  const publish = await fetch(`${baseUrl}/v1/policies/bundles`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      name: "Strict Bundle",
      rules: [
        {
          ruleId: "deny-secret",
          description: "Deny secret",
          actionPattern: "*",
          dataClasses: ["SECRET"],
          effect: "DENY",
          obligations: ["incident"],
          enabled: true
        }
      ]
    })
  });
  assert.equal(publish.status, 201);
  const body = (await publish.json()) as { bundle: { version: number; name: string } };
  assert.equal(body.bundle.version, 2);
  assert.equal(body.bundle.name, "Strict Bundle");
});

test("requires actor context on evaluate", async () => {
  const evaluate = await fetch(`${baseUrl}/v1/policies/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health"
    },
    body: JSON.stringify({
      action: "workflow.execute",
      resource: "x",
      dataClasses: ["PUBLIC"],
      purpose: "test"
    })
  });
  assert.equal(evaluate.status, 401);
});

