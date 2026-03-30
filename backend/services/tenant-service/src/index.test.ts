import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3912;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/tenant-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("platform admin can create tenant and update isolation", async () => {
  const create = await fetch(`${baseUrl}/v1/tenants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "platform_admin"
    },
    body: JSON.stringify({
      tenantId: "tenant-river-hospital",
      displayName: "River Hospital",
      dataResidency: "us-west"
    })
  });
  assert.equal(create.status, 201);

  const patch = await fetch(`${baseUrl}/v1/tenants/tenant-river-hospital/isolation`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-security",
      "x-roles": "security_admin"
    },
    body: JSON.stringify({ isolationState: "locked" })
  });
  assert.equal(patch.status, 200);
  const body = (await patch.json()) as { isolationState: string };
  assert.equal(body.isolationState, "locked");
});

test("cross-tenant read is denied without platform admin", async () => {
  const read = await fetch(`${baseUrl}/v1/tenants/tenant-starlight-health`, {
    headers: {
      "x-tenant-id": "tenant-other",
      "x-actor-id": "user-operator"
    }
  });
  assert.equal(read.status, 403);
});

