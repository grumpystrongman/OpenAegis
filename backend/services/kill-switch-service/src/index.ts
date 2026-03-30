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
  sha256Hex,
  stableSerialize,
  type JsonMap
} from "@openaegis/security-kit";

export const descriptor: ServiceDescriptor = {
  serviceName: "kill-switch-service",
  listeningPort: Number(process.env.PORT ?? 3016),
  purpose: "Emergency halt and scoped circuit breakers",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type KillSeverity = "high" | "critical";
type CircuitStatus = "triggered" | "released";

interface KillScope {
  tenantId: string;
  workflowId?: string;
  serviceName?: string;
}

interface CircuitRecord {
  circuitId: string;
  scope: KillScope;
  status: CircuitStatus;
  reason: string;
  severity: KillSeverity;
  triggeredBy: string;
  triggeredAt: string;
  releasedBy?: string;
  releasedAt?: string;
  revision: number;
}

interface KillEvent {
  eventId: string;
  eventType: "TRIGGERED" | "RELEASED";
  circuitId: string;
  scope: KillScope;
  tenantId: string;
  actorId: string;
  reason: string;
  severity: KillSeverity;
  createdAt: string;
  prevHash?: string;
  hash: string;
}

interface KillSwitchState {
  version: number;
  circuits: CircuitRecord[];
  events: KillEvent[];
}

const stateFile = resolve(process.cwd(), ".volumes", "kill-switch-service-state.json");
const limiter = new InMemoryRateLimiter(150, 60_000);

const normalizeState = (state: Partial<KillSwitchState> | undefined): KillSwitchState => ({
  version: 1,
  circuits: Array.isArray(state?.circuits) ? state.circuits : [],
  events: Array.isArray(state?.events) ? state.events : []
});

const loadState = async (): Promise<KillSwitchState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<KillSwitchState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: KillSwitchState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toSeverity = (value: unknown): KillSeverity => (value === "critical" ? "critical" : "high");

const scopesEqual = (left: KillScope, right: KillScope): boolean =>
  left.tenantId === right.tenantId &&
  left.workflowId === right.workflowId &&
  left.serviceName === right.serviceName;

const buildCircuitId = (scope: KillScope): string => {
  const fingerprint = `${scope.tenantId}|${scope.workflowId ?? "*"}|${scope.serviceName ?? "*"}`;
  return `ks-${sha256Hex(fingerprint).slice(0, 24)}`;
};

const canonicalEventPayload = (event: Omit<KillEvent, "hash">) => ({
  eventId: event.eventId,
  eventType: event.eventType,
  circuitId: event.circuitId,
  scope: event.scope,
  tenantId: event.tenantId,
  actorId: event.actorId,
  reason: event.reason,
  severity: event.severity,
  createdAt: event.createdAt,
  prevHash: event.prevHash ?? null
});

const buildEvent = (input: Omit<KillEvent, "hash" | "eventId" | "createdAt"> & { prevHash?: string }): KillEvent => {
  const eventWithoutHash: Omit<KillEvent, "hash"> = {
    eventId: `kse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: input.eventType,
    circuitId: input.circuitId,
    scope: input.scope,
    tenantId: input.tenantId,
    actorId: input.actorId,
    reason: input.reason,
    severity: input.severity,
    createdAt: nowIso(),
    ...(input.prevHash ? { prevHash: input.prevHash } : {})
  };
  const hash = sha256Hex(stableSerialize(canonicalEventPayload(eventWithoutHash)));
  return { ...eventWithoutHash, hash };
};

const verifyEventChain = (events: KillEvent[]) => {
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!;
    const expectedHash = sha256Hex(stableSerialize(canonicalEventPayload({
      eventId: current.eventId,
      eventType: current.eventType,
      circuitId: current.circuitId,
      scope: current.scope,
      tenantId: current.tenantId,
      actorId: current.actorId,
      reason: current.reason,
      severity: current.severity,
      createdAt: current.createdAt,
      ...(current.prevHash ? { prevHash: current.prevHash } : {})
    })));
    if (expectedHash !== current.hash) return { valid: false, reason: "hash_mismatch", index };
    if (index > 0 && current.prevHash !== events[index - 1]!.hash) {
      return { valid: false, reason: "prev_hash_mismatch", index };
    }
    if (index === 0 && current.prevHash) {
      return { valid: false, reason: "unexpected_genesis_prev_hash", index };
    }
  }
  return { valid: true as const };
};

const enforceTenantScope = (
  response: ServerResponse,
  requestId: string,
  contextTenantId: string,
  requestedTenantId: string,
  roles: string[]
): boolean => {
  if (contextTenantId === requestedTenantId || roles.includes("platform_admin")) return true;
  sendJson(response, 403, { error: "cross_tenant_scope_denied" }, requestId);
  return false;
};

const parseScope = (body: JsonMap, fallbackTenantId: string): KillScope => {
  const tenantId = toString(body.tenantId) ?? fallbackTenantId;
  const workflowId = toString(body.workflowId);
  const serviceName = toString(body.serviceName);
  return {
    tenantId,
    ...(workflowId ? { workflowId } : {}),
    ...(serviceName ? { serviceName } : {})
  };
};

const listScopedCircuits = (state: KillSwitchState, filters: {
  tenantId: string;
  workflowId?: string;
  serviceName?: string;
  status?: CircuitStatus;
  severity?: KillSeverity;
}) =>
  state.circuits
    .filter((item) => item.scope.tenantId === filters.tenantId)
    .filter((item) => !filters.workflowId || item.scope.workflowId === filters.workflowId)
    .filter((item) => !filters.serviceName || item.scope.serviceName === filters.serviceName)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.severity || item.severity === filters.severity)
    .sort((left, right) => right.triggeredAt.localeCompare(left.triggeredAt));

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
    const chain = verifyEventChain(state.events);
    sendJson(
      response,
      200,
      {
        status: "ok",
        service: descriptor.serviceName,
        circuits: state.circuits.length,
        activeCircuits: state.circuits.filter((item) => item.status === "triggered").length,
        immutableEventChainValid: chain.valid
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && path === "/v1/kill-switch/status") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin", "auditor"] },
      context
    );
    if (!secured) return;
    const queryTenantId = toString(parsedUrl.searchParams.get("tenantId") ?? undefined) ?? secured.tenantId!;
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, queryTenantId, secured.roles)) return;

    const statusFilter = parsedUrl.searchParams.get("status");
    const severityFilter = parsedUrl.searchParams.get("severity");
    const state = await loadState();
    const circuits = listScopedCircuits(state, {
      tenantId: queryTenantId,
      ...(toString(parsedUrl.searchParams.get("workflowId") ?? undefined)
        ? { workflowId: toString(parsedUrl.searchParams.get("workflowId") ?? undefined)! }
        : {}),
      ...(toString(parsedUrl.searchParams.get("serviceName") ?? undefined)
        ? { serviceName: toString(parsedUrl.searchParams.get("serviceName") ?? undefined)! }
        : {}),
      ...(statusFilter === "triggered" || statusFilter === "released" ? { status: statusFilter } : {}),
      ...(severityFilter === "critical" || severityFilter === "high" ? { severity: severityFilter } : {})
    });
    sendJson(
      response,
      200,
      {
        circuits,
        totals: {
          total: circuits.length,
          active: circuits.filter((item) => item.status === "triggered").length,
          released: circuits.filter((item) => item.status === "released").length
        }
      },
      secured.requestId
    );
    return;
  }

  if (method === "GET" && path === "/v1/kill-switch/events") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const queryTenantId = toString(parsedUrl.searchParams.get("tenantId") ?? undefined) ?? secured.tenantId!;
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, queryTenantId, secured.roles)) return;

    const state = await loadState();
    const severityFilter = parsedUrl.searchParams.get("severity");
    const rawLimit = Number(parsedUrl.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 200;
    const tenantEvents = state.events.filter((event) => event.tenantId === queryTenantId);
    const filtered = tenantEvents
      .filter((event) => severityFilter !== "high" && severityFilter !== "critical" ? true : event.severity === severityFilter)
      .slice()
      .reverse()
      .slice(0, limit);
    sendJson(
      response,
      200,
      {
        events: filtered,
        chainVerification: verifyEventChain(tenantEvents)
      },
      secured.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/kill-switch/trigger") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const scope = parseScope(body, secured.tenantId!);
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, scope.tenantId, secured.roles)) return;

    const reason = toString(body.reason) ?? "manual_kill_switch_trigger";
    const severity = toSeverity(body.severity);
    const state = await loadState();
    const existingIndex = state.circuits.findIndex((item) => scopesEqual(item.scope, scope));
    const previousHash = state.events.length > 0 ? state.events[state.events.length - 1]!.hash : undefined;

    let circuit: CircuitRecord;
    if (existingIndex >= 0) {
      const existing = state.circuits[existingIndex]!;
      if (existing.status === "triggered") {
        sendJson(response, 200, { circuit: existing, idempotent: true }, secured.requestId);
        return;
      }
      circuit = {
        circuitId: existing.circuitId,
        scope,
        status: "triggered",
        reason,
        severity,
        triggeredBy: secured.actorId!,
        triggeredAt: nowIso(),
        revision: existing.revision + 1
      };
      state.circuits[existingIndex] = circuit;
    } else {
      circuit = {
        circuitId: buildCircuitId(scope),
        scope,
        status: "triggered",
        reason,
        severity,
        triggeredBy: secured.actorId!,
        triggeredAt: nowIso(),
        revision: 1
      };
      state.circuits.push(circuit);
    }

    const event = buildEvent({
      eventType: "TRIGGERED",
      circuitId: circuit.circuitId,
      scope: circuit.scope,
      tenantId: circuit.scope.tenantId,
      actorId: secured.actorId!,
      reason: circuit.reason,
      severity: circuit.severity,
      ...(previousHash ? { prevHash: previousHash } : {})
    });
    state.events.push(event);
    await saveState(state);
    sendJson(response, existingIndex >= 0 ? 200 : 201, { circuit, event }, secured.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/kill-switch/release") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const circuitId = toString(body.circuitId);
    const state = await loadState();

    let circuit: CircuitRecord | undefined;
    if (circuitId) {
      circuit = state.circuits.find((item) => item.circuitId === circuitId);
      if (!circuit) {
        sendJson(response, 404, { error: "circuit_not_found" }, secured.requestId);
        return;
      }
      if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, circuit.scope.tenantId, secured.roles)) return;
    } else {
      const scope = parseScope(body, secured.tenantId!);
      if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, scope.tenantId, secured.roles)) return;
      circuit = state.circuits.find((item) => item.status === "triggered" && scopesEqual(item.scope, scope));
      if (!circuit) {
        sendJson(response, 404, { error: "active_circuit_not_found" }, secured.requestId);
        return;
      }
    }

    if (circuit.status !== "triggered") {
      sendJson(response, 409, { error: "circuit_already_released" }, secured.requestId);
      return;
    }

    const releaseReason = toString(body.reason) ?? "manual_kill_switch_release";
    const nextRecord: CircuitRecord = {
      ...circuit,
      status: "released",
      reason: releaseReason,
      releasedBy: secured.actorId!,
      releasedAt: nowIso(),
      revision: circuit.revision + 1
    };
    const index = state.circuits.findIndex((item) => item.circuitId === circuit.circuitId);
    state.circuits[index] = nextRecord;

    const previousHash = state.events.length > 0 ? state.events[state.events.length - 1]!.hash : undefined;
    const event = buildEvent({
      eventType: "RELEASED",
      circuitId: nextRecord.circuitId,
      scope: nextRecord.scope,
      tenantId: nextRecord.scope.tenantId,
      actorId: secured.actorId!,
      reason: releaseReason,
      severity: nextRecord.severity,
      ...(previousHash ? { prevHash: previousHash } : {})
    });
    state.events.push(event);
    await saveState(state);
    sendJson(response, 200, { circuit: nextRecord, event }, secured.requestId);
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
