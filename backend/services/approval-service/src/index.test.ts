import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3915;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/approval-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("critical approval requires dual approvers", async () => {
  const create = await fetch(`${baseUrl}/v1/approvals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-requester"
    },
    body: JSON.stringify({ reason: "critical change", riskLevel: "critical" })
  });
  assert.equal(create.status, 201);
  const approval = (await create.json()) as { approvalId: string; status: string };
  assert.equal(approval.status, "pending");

  const first = await fetch(`${baseUrl}/v1/approvals/${approval.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-approver-1",
      "x-roles": "approver"
    },
    body: JSON.stringify({ decision: "approve" })
  });
  const firstBody = (await first.json()) as { status: string };
  assert.equal(firstBody.status, "pending");

  const second = await fetch(`${baseUrl}/v1/approvals/${approval.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-approver-2",
      "x-roles": "approver"
    },
    body: JSON.stringify({ decision: "approve" })
  });
  const secondBody = (await second.json()) as { status: string };
  assert.equal(secondBody.status, "approved");
});

test("reject decision moves approval to rejected", async () => {
  const create = await fetch(`${baseUrl}/v1/approvals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-requester"
    },
    body: JSON.stringify({ reason: "high risk", riskLevel: "high" })
  });
  const approval = (await create.json()) as { approvalId: string };

  const reject = await fetch(`${baseUrl}/v1/approvals/${approval.approvalId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-approver",
      "x-roles": "approver"
    },
    body: JSON.stringify({ decision: "reject", reason: "safety issue" })
  });
  assert.equal(reject.status, 200);
  const body = (await reject.json()) as { status: string };
  assert.equal(body.status, "rejected");
});

