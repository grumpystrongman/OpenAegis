import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createAppServer } from "./index.js";

const baseUrl = "http://127.0.0.1:3906";
let server: ReturnType<typeof createAppServer>;
const securityHeaders = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-security",
  "x-roles": "security_admin,platform_admin"
};
const auditorHeaders = {
  "x-tenant-id": "tenant-starlight-health",
  "x-actor-id": "user-auditor",
  "x-roles": "auditor"
};

beforeEach(async () => {
  await rm(".volumes/tool-registry-state.json", { force: true });
  server = createAppServer();
  server.listen(3906);
  await once(server, "listening");
});

test.afterEach(async () => {
  server.close();
  await once(server, "close");
});

test("lists default published manifests including the expanded connector catalog", async () => {
  const response = await fetch(`${baseUrl}/v1/tools?status=published`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    manifests: Array<{ toolId: string; status: string; authMethods: string[] }>;
  };
  assert.ok(body.manifests.length >= 16);
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-aws-infrastructure"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-databricks-workspace"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-fabric-automation"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-jira-workflow"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-confluence-knowledge"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-openai-responses"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-anthropic-claude"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-google-gemini"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-azure-openai"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-airbyte-sync"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-airflow-ops"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-trino-query"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-superset-insights"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-metabase-analytics"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-grafana-observability"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-kafka-streams"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-nifi-flow"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-dagster-orchestration"));
  assert.ok(body.manifests.some((manifest) => manifest.toolId === "connector-n8n-workflows"));
  assert.ok(body.manifests.every((manifest) => manifest.status === "published"));
  assert.ok(body.manifests.every((manifest) => manifest.authMethods.length > 0));
});

test("creates a plugin instance with vault-backed api key, lists it, and tests it", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-openai-responses",
      displayName: "OpenAI production",
      auth: {
        method: "api_key",
        refs: {
          apiKeyRef: "vault://tenants/demo/openai/api-key"
        }
      },
      config: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o"
      }
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as {
    instanceId: string;
    tenantId: string;
    manifestToolId: string;
    status: string;
    auth: { method: string; refs: { apiKeyRef: string } };
  };
  assert.ok(created.instanceId.startsWith("plugin-inst-"));
  assert.equal(created.tenantId, "tenant-starlight-health");
  assert.equal(created.manifestToolId, "connector-openai-responses");
  assert.equal(created.status, "ready");
  assert.equal(created.auth.method, "api_key");
  assert.equal(created.auth.refs.apiKeyRef, "vault://tenants/demo/openai/api-key");

  const list = await fetch(`${baseUrl}/v1/plugins/instances?manifestToolId=connector-openai-responses`, {
    headers: auditorHeaders
  });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { instances: Array<{ instanceId: string }> };
  assert.equal(listBody.instances.length, 1);
  assert.equal(listBody.instances[0]?.instanceId, created.instanceId);

  const testResponse = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/test`, {
    method: "POST",
    headers: securityHeaders
  });
  assert.equal(testResponse.status, 200);
  const tested = (await testResponse.json()) as {
    status: string;
    lastTestStatus: string;
    lastTestMessage: string;
  };
  assert.equal(tested.status, "healthy");
  assert.equal(tested.lastTestStatus, "passed");
  assert.match(tested.lastTestMessage, /connector-openai-responses/);
});

test("rejects raw secrets in plugin instance auth payloads", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-openai-responses",
      displayName: "Bad OpenAI instance",
      auth: {
        method: "api_key",
        refs: {
          apiKeyRef: "sk-live-raw-secret"
        }
      }
    })
  });

  assert.equal(create.status, 400);
  const body = (await create.json()) as { error: string };
  assert.equal(body.error, "secret_reference_must_use_vault_prefix:apiKeyRef");
});

test("rejects unsupported auth methods for a catalog entry", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-openai-responses",
      displayName: "Wrong auth method",
      auth: {
        method: "oauth2"
      }
    })
  });

  assert.equal(create.status, 400);
  const body = (await create.json()) as { error: string };
  assert.equal(body.error, "instance_auth_method_not_supported_by_manifest");
});

test("authorizes oauth2 instances with broker refs only and then tests them", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-jira-workflow",
      displayName: "Jira oauth instance",
      auth: {
        method: "oauth2"
      }
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { instanceId: string; status: string };
  assert.equal(created.status, "pending_authorization");

  const preTest = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/test`, {
    method: "POST",
    headers: securityHeaders
  });
  assert.equal(preTest.status, 409);
  const preTestBody = (await preTest.json()) as { error: string };
  assert.equal(preTestBody.error, "instance_auth_not_ready");

  const authorize = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/authorize`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      authorizationBrokerRef: "broker://oauth/jira/authorize",
      tokenBrokerRef: "broker://oauth/jira/token",
      refreshTokenBrokerRef: "broker://oauth/jira/refresh"
    })
  });
  assert.equal(authorize.status, 200);
  const authorized = (await authorize.json()) as {
    status: string;
    brokerRefs: { tokenBrokerRef: string; authorizationBrokerRef: string };
    lastAuthorizedAt: string;
  };
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.brokerRefs.tokenBrokerRef, "broker://oauth/jira/token");
  assert.equal(authorized.brokerRefs.authorizationBrokerRef, "broker://oauth/jira/authorize");
  assert.ok(authorized.lastAuthorizedAt.length > 0);

  const testResponse = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/test`, {
    method: "POST",
    headers: securityHeaders
  });
  assert.equal(testResponse.status, 200);
  const tested = (await testResponse.json()) as { status: string; lastTestStatus: string };
  assert.equal(tested.status, "healthy");
  assert.equal(tested.lastTestStatus, "passed");
});

test("rejects non-broker references during authorization", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-jira-workflow",
      displayName: "Jira oauth instance",
      auth: {
        method: "oauth2"
      }
    })
  });
  const created = (await create.json()) as { instanceId: string };

  const authorize = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/authorize`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      tokenBrokerRef: "vault://not-allowed"
    })
  });

  assert.equal(authorize.status, 400);
  const body = (await authorize.json()) as { error: string };
  assert.equal(body.error, "broker_reference_must_use_broker_prefix:tokenBrokerRef");
});

test("creates a manifest with omitted auth methods by inferring sensible defaults", async () => {
  const create = await fetch(`${baseUrl}/v1/tools`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      toolId: "connector-custom-research",
      displayName: "Custom Research Connector",
      connectorType: "project",
      description: "Draft connector for research workflows",
      trustTier: "tier-3",
      allowedActions: ["READ", "EXECUTE"],
      permissionScopes: ["research.read", "research.execute"],
      outboundDomains: ["research.internal.local"],
      signature: "sig-custom-v1"
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { toolId: string; status: string; authMethods: string[] };
  assert.equal(created.toolId, "connector-custom-research");
  assert.equal(created.status, "draft");
  assert.ok(created.authMethods.length > 0);
});

test("manifest create requires privileged security context", async () => {
  const create = await fetch(`${baseUrl}/v1/tools`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-starlight-health",
      "x-actor-id": "user-clinician",
      "x-roles": "workflow_operator"
    },
    body: JSON.stringify({
      toolId: "connector-unprivileged-create",
      displayName: "Denied Connector",
      connectorType: "project",
      description: "Should be denied",
      trustTier: "tier-3",
      allowedActions: ["READ"],
      permissionScopes: ["project.read"],
      outboundDomains: ["project.internal.local"],
      signature: "sig-denied-v1"
    })
  });

  assert.equal(create.status, 403);
  const body = (await create.json()) as { error: string };
  assert.equal(body.error, "insufficient_role");
});

test("hides plugin instances from other tenants", async () => {
  const create = await fetch(`${baseUrl}/v1/plugins/instances`, {
    method: "POST",
    headers: securityHeaders,
    body: JSON.stringify({
      manifestToolId: "connector-openai-responses",
      displayName: "Tenant isolated instance",
      auth: {
        method: "api_key",
        refs: {
          apiKeyRef: "vault://tenants/demo/openai/api-key"
        }
      }
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { instanceId: string };

  const crossTenantList = await fetch(`${baseUrl}/v1/plugins/instances`, {
    headers: {
      "x-tenant-id": "tenant-other-health",
      "x-actor-id": "user-other-security",
      "x-roles": "security_admin"
    }
  });
  assert.equal(crossTenantList.status, 200);
  const listBody = (await crossTenantList.json()) as { instances: Array<{ instanceId: string }> };
  assert.equal(listBody.instances.some((instance) => instance.instanceId === created.instanceId), false);

  const crossTenantAuthorize = await fetch(`${baseUrl}/v1/plugins/instances/${created.instanceId}/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-other-health",
      "x-actor-id": "user-other-security",
      "x-roles": "security_admin"
    },
    body: JSON.stringify({
      authorizationBrokerRef: "broker://oauth/jira/authorize"
    })
  });
  assert.equal(crossTenantAuthorize.status, 404);
});
