import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.ts";

const port = 3923;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createAppServer>;

beforeEach(async () => {
  await rm(".volumes/context-retrieval-service-state.json", { force: true });
  server = createAppServer();
  server.listen(port);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("indexes and retrieves policy-allowed context documents", async () => {
  const indexResponse = await fetch(`${baseUrl}/v1/context/index`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-operator",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      docId: "doc-discharge-001",
      title: "Discharge Follow-Up Plan",
      content: "Patient discharge checklist and medication follow-up instructions for home care.",
      dataClass: "PHI",
      source: "fhir",
      allowedRoles: ["workflow_operator"],
      purposeTags: ["discharge"]
    })
  });
  assert.equal(indexResponse.status, 201);

  const queryResponse = await fetch(`${baseUrl}/v1/context/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-operator",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      query: "discharge medication follow up",
      purpose: "discharge",
      limit: 5,
      allowedDataClasses: ["PHI"]
    })
  });

  assert.equal(queryResponse.status, 200);
  const queryBody = (await queryResponse.json()) as {
    queryId: string;
    resultCount: number;
    results: Array<{ docId: string; dataClass: string }>;
  };
  assert.ok(queryBody.queryId.startsWith("qry-"));
  assert.equal(queryBody.resultCount, 1);
  assert.equal(queryBody.results[0]?.docId, "doc-discharge-001");
  assert.equal(queryBody.results[0]?.dataClass, "PHI");
});

test("denies indexing request for insufficient role", async () => {
  const response = await fetch(`${baseUrl}/v1/context/index`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-analyst",
      "x-roles": "analyst"
    },
    body: JSON.stringify({
      docId: "doc-001",
      title: "Ops Doc",
      content: "hello",
      dataClass: "INTERNAL"
    })
  });

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "insufficient_role");
});
