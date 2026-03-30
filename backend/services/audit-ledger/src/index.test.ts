import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3916;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

const headers = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "auditor,security_admin"
};

beforeEach(async () => {
  await rm(".volumes/audit-ledger-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("stores immutable evidence chain and verifies chain integrity", async () => {
  const first = await fetch(`${baseUrl}/v1/audit/evidence`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      evidenceId: "ev-1",
      executionId: "ex-1",
      dataSources: ["fhir"],
      policyIds: ["policy-1"],
      outputClassification: "EPHI",
      blocked: false,
      finalDisposition: "completed"
    })
  });
  assert.equal(first.status, 201);

  const second = await fetch(`${baseUrl}/v1/audit/evidence`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      evidenceId: "ev-2",
      executionId: "ex-1",
      dataSources: ["sql"],
      policyIds: ["policy-2"],
      outputClassification: "EPHI",
      blocked: true,
      finalDisposition: "blocked"
    })
  });
  assert.equal(second.status, 201);

  const verify = await fetch(`${baseUrl}/v1/audit/verify-chain`, { headers });
  assert.equal(verify.status, 200);
  const verifyBody = (await verify.json()) as { valid: boolean };
  assert.equal(verifyBody.valid, true);
});

test("requires audit role for list access", async () => {
  const list = await fetch(`${baseUrl}/v1/audit/evidence`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-clinician"
    }
  });
  assert.equal(list.status, 403);
});

