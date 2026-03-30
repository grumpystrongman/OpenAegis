import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3917;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/notification-service-state.json", { force: true });
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

test("health exposes notification metrics", async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { service: string; totalNotifications: number };
  assert.equal(body.service, "notification-service");
  assert.equal(body.totalNotifications, 0);
});

test("creates, lists, sends, and acknowledges notifications", async () => {
  const create = await fetch(`${baseUrl}/v1/notifications`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      recipient: "security@starlighthealth.org",
      subject: "Approval needed",
      body: "A live discharge workflow is waiting for review.",
      channel: "email"
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { notificationId: string; status: string };
  assert.equal(created.status, "queued");

  const list = await fetch(`${baseUrl}/v1/notifications`, { headers: operatorHeaders });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { notifications: Array<{ notificationId: string }> };
  assert.equal(listBody.notifications.length, 1);

  const send = await fetch(`${baseUrl}/v1/notifications/${created.notificationId}/send`, {
    method: "POST",
    headers: adminHeaders
  });
  assert.equal(send.status, 200);
  const sent = (await send.json()) as { status: string; sentAt: string };
  assert.equal(sent.status, "sent");
  assert.ok(sent.sentAt.length > 0);

  const ack = await fetch(`${baseUrl}/v1/notifications/${created.notificationId}/ack`, {
    method: "POST",
    headers: operatorHeaders
  });
  assert.equal(ack.status, 200);
  const acknowledged = (await ack.json()) as { status: string; acknowledgedAt: string };
  assert.equal(acknowledged.status, "acknowledged");
  assert.ok(acknowledged.acknowledgedAt.length > 0);
});

test("blocks creation without admin privileges and returns 404 for missing notifications", async () => {
  const denied = await fetch(`${baseUrl}/v1/notifications`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({
      recipient: "security@starlighthealth.org",
      subject: "Approval needed",
      body: "A live discharge workflow is waiting for review."
    })
  });
  assert.equal(denied.status, 403);

  const missing = await fetch(`${baseUrl}/v1/notifications/nt-missing`, { headers: operatorHeaders });
  assert.equal(missing.status, 404);
});

