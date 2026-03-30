import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3914;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

const adminHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,auditor"
};

beforeEach(async () => {
  await rm(".volumes/secrets-broker-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("registers secret and leases short-lived credential", async () => {
  const register = await fetch(`${baseUrl}/v1/secrets/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/fhir/token",
      value: "super-secret-token"
    })
  });
  assert.equal(register.status, 201);

  const lease = await fetch(`${baseUrl}/v1/secrets/lease`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/fhir/token",
      purpose: "fhir-read",
      ttlSeconds: 300
    })
  });
  assert.equal(lease.status, 200);
  const leaseBody = (await lease.json()) as { leaseId: string; secretValue: string };
  assert.ok(leaseBody.leaseId.startsWith("lease-"));
  assert.equal(leaseBody.secretValue, "super-secret-token");
});

test("revokes active lease", async () => {
  await fetch(`${baseUrl}/v1/secrets/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/sql/password",
      value: "password-1"
    })
  });
  const lease = await fetch(`${baseUrl}/v1/secrets/lease`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/sql/password"
    })
  });
  const leaseBody = (await lease.json()) as { leaseId: string };

  const revoke = await fetch(`${baseUrl}/v1/secrets/revoke`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ leaseId: leaseBody.leaseId })
  });
  assert.equal(revoke.status, 200);

  const leases = await fetch(`${baseUrl}/v1/secrets/leases`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "auditor"
    }
  });
  assert.equal(leases.status, 200);
  const list = (await leases.json()) as { leases: Array<{ status: string }> };
  assert.ok(list.leases.some((item) => item.status === "revoked"));
});

