import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3911;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/auth-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("issues token and introspects active session", async () => {
  const issue = await fetch(`${baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security@starlighthealth.org" })
  });
  assert.equal(issue.status, 200);
  const issued = (await issue.json()) as { accessToken: string };
  assert.ok(issued.accessToken.length > 20);

  const introspect = await fetch(`${baseUrl}/v1/auth/introspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security"
    },
    body: JSON.stringify({ token: issued.accessToken })
  });
  assert.equal(introspect.status, 200);
  const body = (await introspect.json()) as { active: boolean; tenantId?: string };
  assert.equal(body.active, true);
  assert.equal(body.tenantId, "tenant-starlight-health");
});

test("revokes token and marks introspection inactive", async () => {
  const issue = await fetch(`${baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const issued = (await issue.json()) as { accessToken: string };

  const revoke = await fetch(`${baseUrl}/v1/auth/revoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security"
    },
    body: JSON.stringify({ token: issued.accessToken })
  });
  assert.equal(revoke.status, 200);

  const introspect = await fetch(`${baseUrl}/v1/auth/introspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security"
    },
    body: JSON.stringify({ token: issued.accessToken })
  });
  const body = (await introspect.json()) as { active: boolean };
  assert.equal(body.active, false);
});

test("requires security context for introspection", async () => {
  const issue = await fetch(`${baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "clinician@starlighthealth.org" })
  });
  const issued = (await issue.json()) as { accessToken: string };

  const introspect = await fetch(`${baseUrl}/v1/auth/introspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: issued.accessToken })
  });
  assert.equal(introspect.status, 400);
});

