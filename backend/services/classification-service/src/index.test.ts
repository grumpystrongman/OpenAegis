import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3922;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/classification-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("classifies PHI/PII content and stores auditable event", async () => {
  const classifyResponse = await fetch(`${baseUrl}/v1/classification/classify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-ops",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      text: "Patient MRN: 991122 and contact jane.doe@example.com for discharge medication summary.",
      metadata: { source: "internal", purpose: "discharge" }
    })
  });

  assert.equal(classifyResponse.status, 200);
  const classifyBody = (await classifyResponse.json()) as {
    classificationId: string;
    dominantClass: string;
    classes: string[];
    redactedText: string;
  };
  assert.ok(classifyBody.classificationId.startsWith("cls-"));
  assert.ok(classifyBody.classes.includes("PHI"));
  assert.ok(classifyBody.classes.includes("PII"));
  assert.ok(classifyBody.redactedText.includes("[REDACTED_EMAIL]"));

  const eventsResponse = await fetch(`${baseUrl}/v1/classification/events`, {
    headers: {
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-auditor",
      "x-roles": "auditor"
    }
  });
  assert.equal(eventsResponse.status, 200);
  const eventsBody = (await eventsResponse.json()) as { events: Array<{ classificationId: string }> };
  assert.equal(eventsBody.events.length, 1);
  assert.equal(eventsBody.events[0]?.classificationId, classifyBody.classificationId);
});

test("denies classification when actor context is missing", async () => {
  const response = await fetch(`${baseUrl}/v1/classification/classify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({ text: "hello world", metadata: { source: "internal" } })
  });

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "actor_context_required");
});
