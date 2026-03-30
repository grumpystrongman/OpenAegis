import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import {
  InMemoryRateLimiter,
  enforceRateLimit,
  enforceSecurity,
  nowIso,
  parseContext,
  readJson,
  sendJson,
  type JsonMap
} from "@openaegis/security-kit";

export const descriptor: ServiceDescriptor = {
  serviceName: "tenant-service",
  listeningPort: Number(process.env.PORT ?? 3002),
  purpose: "Tenant lifecycle and isolation guardrails",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type IsolationState = "active" | "suspended" | "locked";

interface TenantRecord {
  tenantId: string;
  displayName: string;
  dataResidency: string;
  environment: "dev" | "staging" | "prod";
  isolationState: IsolationState;
  networkPolicy: "strict" | "standard";
  createdAt: string;
  updatedAt: string;
}

interface TenantState {
  version: number;
  tenants: TenantRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "tenant-service-state.json");
const limiter = new InMemoryRateLimiter(100, 60_000);

const defaultTenants = (): TenantRecord[] => [
  {
    tenantId: "tenant-starlight-health",
    displayName: "Starlight Health",
    dataResidency: "us-east",
    environment: "prod",
    isolationState: "active",
    networkPolicy: "strict",
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
];

const normalizeState = (state: Partial<TenantState> | undefined): TenantState => ({
  version: 1,
  tenants: Array.isArray(state?.tenants) && state.tenants.length > 0 ? state.tenants : defaultTenants()
});

const loadState = async (): Promise<TenantState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<TenantState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: TenantState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const path = parsedUrl.pathname;
  const context = parseContext(request);

  if (!enforceRateLimit(response, context.requestId, limiter.check(`${request.socket.remoteAddress ?? "unknown"}:${path}`))) {
    return;
  }

  if (method === "GET" && path === "/healthz") {
    const state = await loadState();
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, tenants: state.tenants.length }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/tenants") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    sendJson(response, 200, { tenants: state.tenants }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/tenants\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const tenantId = path.split("/")[3] ?? "";
    const state = await loadState();
    const tenant = state.tenants.find((item) => item.tenantId === tenantId);
    if (!tenant) {
      sendJson(response, 404, { error: "tenant_not_found" }, context.requestId);
      return;
    }
    if (secured.tenantId !== tenantId && !secured.roles.includes("platform_admin")) {
      sendJson(response, 403, { error: "cross_tenant_access_denied" }, context.requestId);
      return;
    }
    sendJson(response, 200, tenant, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/tenants") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const tenantId = toString(body.tenantId);
    const displayName = toString(body.displayName);
    const dataResidency = toString(body.dataResidency) ?? "us-east";
    const environment = body.environment === "dev" || body.environment === "staging" ? body.environment : "prod";
    const networkPolicy = body.networkPolicy === "standard" ? "standard" : "strict";

    if (!tenantId || !displayName) {
      sendJson(response, 400, { error: "tenant_id_and_display_name_required" }, context.requestId);
      return;
    }

    const state = await loadState();
    if (state.tenants.some((item) => item.tenantId === tenantId)) {
      sendJson(response, 409, { error: "tenant_already_exists" }, context.requestId);
      return;
    }
    const record: TenantRecord = {
      tenantId,
      displayName,
      dataResidency,
      environment,
      isolationState: "active",
      networkPolicy,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.tenants.push(record);
    await saveState(state);
    sendJson(response, 201, record, context.requestId);
    return;
  }

  if (method === "PATCH" && /^\/v1\/tenants\/[^/]+\/isolation$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const nextState = body.isolationState === "suspended" || body.isolationState === "locked" ? body.isolationState : "active";
    const tenantId = path.split("/")[3] ?? "";
    const state = await loadState();
    const tenant = state.tenants.find((item) => item.tenantId === tenantId);
    if (!tenant) {
      sendJson(response, 404, { error: "tenant_not_found" }, context.requestId);
      return;
    }
    tenant.isolationState = nextState;
    tenant.updatedAt = nowIso();
    await saveState(state);
    sendJson(response, 200, tenant, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/tenants\/[^/]+\/policy$/.test(path)) {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const tenantId = path.split("/")[3] ?? "";
    const state = await loadState();
    const tenant = state.tenants.find((item) => item.tenantId === tenantId);
    if (!tenant) {
      sendJson(response, 404, { error: "tenant_not_found" }, context.requestId);
      return;
    }
    sendJson(
      response,
      200,
      {
        tenantId: tenant.tenantId,
        policy: {
          networkEgress: tenant.networkPolicy === "strict" ? "deny-by-default" : "managed-allowlist",
          crossTenantAccess: "blocked",
          defaultClassification: "EPHI",
          approvalMode: "risk-based"
        }
      },
      context.requestId
    );
    return;
  }

  sendJson(response, 404, { error: "not_found", service: descriptor.serviceName, path }, context.requestId);
};

export const createAppServer = () =>
  createServer((request, response) => {
    void requestHandler(request, response).catch((error: unknown) => {
      const requestId = parseContext(request).requestId;
      if (error instanceof Error && error.message === "payload_too_large") {
        sendJson(response, 413, { error: "payload_too_large" }, requestId);
        return;
      }
      sendJson(response, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" }, requestId);
    });
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(`${descriptor.serviceName} listening on :${descriptor.listeningPort}`);
  });
}
