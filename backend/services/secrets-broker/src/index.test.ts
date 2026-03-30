import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3914;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;
const originalEnv = {
  OPENAEGIS_KMS_PROVIDER: process.env.OPENAEGIS_KMS_PROVIDER,
  OPENAEGIS_AWS_KMS_KEK: process.env.OPENAEGIS_AWS_KMS_KEK,
  OPENAEGIS_AWS_KMS_KEY_VERSION: process.env.OPENAEGIS_AWS_KMS_KEY_VERSION,
  OPENAEGIS_AZURE_KMS_KEK: process.env.OPENAEGIS_AZURE_KMS_KEK,
  OPENAEGIS_GCP_KMS_KEK: process.env.OPENAEGIS_GCP_KMS_KEK,
  OPENAEGIS_KMS_KEY_VERSION: process.env.OPENAEGIS_KMS_KEY_VERSION
};

const adminHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,auditor"
};

beforeEach(async () => {
  process.env.OPENAEGIS_KMS_PROVIDER = originalEnv.OPENAEGIS_KMS_PROVIDER ?? "local";
  process.env.OPENAEGIS_KMS_KEY_VERSION = originalEnv.OPENAEGIS_KMS_KEY_VERSION ?? "v1";
  process.env.OPENAEGIS_AWS_KMS_KEK = originalEnv.OPENAEGIS_AWS_KMS_KEK;
  process.env.OPENAEGIS_AWS_KMS_KEY_VERSION = originalEnv.OPENAEGIS_AWS_KMS_KEY_VERSION;
  process.env.OPENAEGIS_AZURE_KMS_KEK = originalEnv.OPENAEGIS_AZURE_KMS_KEK;
  process.env.OPENAEGIS_GCP_KMS_KEK = originalEnv.OPENAEGIS_GCP_KMS_KEK;
  await rm(".volumes/secrets-broker-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test.after(() => {
  process.env.OPENAEGIS_KMS_PROVIDER = originalEnv.OPENAEGIS_KMS_PROVIDER;
  process.env.OPENAEGIS_AWS_KMS_KEK = originalEnv.OPENAEGIS_AWS_KMS_KEK;
  process.env.OPENAEGIS_AWS_KMS_KEY_VERSION = originalEnv.OPENAEGIS_AWS_KMS_KEY_VERSION;
  process.env.OPENAEGIS_AZURE_KMS_KEK = originalEnv.OPENAEGIS_AZURE_KMS_KEK;
  process.env.OPENAEGIS_GCP_KMS_KEK = originalEnv.OPENAEGIS_GCP_KMS_KEK;
  process.env.OPENAEGIS_KMS_KEY_VERSION = originalEnv.OPENAEGIS_KMS_KEY_VERSION;
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

test("supports provider-specific KMS material for aws mode", async () => {
  process.env.OPENAEGIS_KMS_PROVIDER = "aws";
  process.env.OPENAEGIS_AWS_KMS_KEK = "aws-kek-test-material";
  process.env.OPENAEGIS_AWS_KMS_KEY_VERSION = "aws-v3";

  const register = await fetch(`${baseUrl}/v1/secrets/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/fabric/token",
      value: "fabric-token"
    })
  });
  assert.equal(register.status, 201);

  const inventory = await fetch(`${baseUrl}/v1/secrets/inventory`, { headers: adminHeaders });
  assert.equal(inventory.status, 200);
  const inventoryBody = (await inventory.json()) as { secrets: Array<{ kmsProvider: string; keyVersion: string }> };
  assert.equal(inventoryBody.secrets[0]?.kmsProvider, "aws");
  assert.equal(inventoryBody.secrets[0]?.keyVersion, "aws-v3");

  const lease = await fetch(`${baseUrl}/v1/secrets/lease`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/fabric/token",
      purpose: "fabric-read"
    })
  });
  assert.equal(lease.status, 200);
  const leaseBody = (await lease.json()) as { secretValue: string };
  assert.equal(leaseBody.secretValue, "fabric-token");
});

test("fails closed when configured kms provider has no key material", async () => {
  process.env.OPENAEGIS_KMS_PROVIDER = "gcp";
  delete process.env.OPENAEGIS_GCP_KMS_KEK;
  delete process.env.OPENAEGIS_KMS_KEK;

  const register = await fetch(`${baseUrl}/v1/secrets/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      secretId: "connector/gcp/token",
      value: "gcp-token"
    })
  });

  assert.equal(register.status, 503);
  const body = (await register.json()) as { error: string; detail: string };
  assert.equal(body.error, "kms_provider_not_configured");
  assert.ok(body.detail.includes("kms_kek_material_missing_for_provider_gcp"));
});

