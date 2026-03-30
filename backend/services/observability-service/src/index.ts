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
  serviceName: "observability-service",
  listeningPort: Number(process.env.PORT ?? 3015),
  purpose: "OTel ingestion and SLO analytics",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type EnvelopeKind = "trace" | "metric" | "log";
type Severity = "debug" | "info" | "warning" | "error" | "critical";
type IncidentStatus = "open" | "acknowledged" | "resolved";

interface EnvelopeRecord {
  envelopeId: string;
  tenantId: string;
  actorId: string;
  kind: EnvelopeKind;
  severity: Severity;
  ingestedAt: string;
  occurredAt: string;
  traceId?: string;
  serviceName?: string;
  workflowId?: string;
  payload: JsonMap;
  prevHash?: string;
  hash: string;
}

interface IncidentRecord {
  incidentId: string;
  tenantId: string;
  key: string;
  status: IncidentStatus;
  severity: "error" | "critical";
  title: string;
  traceId?: string;
  serviceName?: string;
  workflowId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  envelopeIds: string[];
}

interface ObservabilityState {
  version: number;
  envelopes: EnvelopeRecord[];
  incidents: IncidentRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "observability-service-state.json");
const limiter = new InMemoryRateLimiter(400, 60_000);

const severityRank: Record<Severity, number> = {
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  critical: 5
};

const normalizeState = (state: Partial<ObservabilityState> | undefined): ObservabilityState => ({
  version: 1,
  envelopes: Array.isArray(state?.envelopes) ? state.envelopes : [],
  incidents: Array.isArray(state?.incidents) ? state.incidents : []
});

const loadState = async (): Promise<ObservabilityState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<ObservabilityState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: ObservabilityState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toSeverity = (value: unknown): Severity => {
  if (value === "debug" || value === "info" || value === "warning" || value === "error" || value === "critical") return value;
  return "info";
};

const toKind = (value: unknown): EnvelopeKind | undefined => {
  if (value === "trace" || value === "metric" || value === "log") return value;
  return undefined;
};

const toIsoOrNow = (value: unknown): string => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return nowIso();
};

const sanitizeAttributes = (value: unknown): JsonMap => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonMap;
};

const canonicalEnvelopePayload = (record: Omit<EnvelopeRecord, "hash">) => ({
  envelopeId: record.envelopeId,
  tenantId: record.tenantId,
  actorId: record.actorId,
  kind: record.kind,
  severity: record.severity,
  ingestedAt: record.ingestedAt,
  occurredAt: record.occurredAt,
  traceId: record.traceId ?? null,
  serviceName: record.serviceName ?? null,
  workflowId: record.workflowId ?? null,
  payload: record.payload,
  prevHash: record.prevHash ?? null
});

const verifyEnvelopeChain = (records: EnvelopeRecord[]) => {
  for (let index = 0; index < records.length; index += 1) {
    const current = records[index]!;
    const expectedHash = sha256Hex(stableSerialize(canonicalEnvelopePayload({
      envelopeId: current.envelopeId,
      tenantId: current.tenantId,
      actorId: current.actorId,
      kind: current.kind,
      severity: current.severity,
      ingestedAt: current.ingestedAt,
      occurredAt: current.occurredAt,
      payload: current.payload,
      ...(current.traceId ? { traceId: current.traceId } : {}),
      ...(current.serviceName ? { serviceName: current.serviceName } : {}),
      ...(current.workflowId ? { workflowId: current.workflowId } : {}),
      ...(current.prevHash ? { prevHash: current.prevHash } : {})
    })));
    if (expectedHash !== current.hash) return { valid: false, reason: "hash_mismatch", index };
    if (index > 0 && current.prevHash !== records[index - 1]!.hash) return { valid: false, reason: "prev_hash_mismatch", index };
    if (index === 0 && current.prevHash) return { valid: false, reason: "unexpected_genesis_prev_hash", index };
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

const parseEnvelopePayload = (body: JsonMap, kind: EnvelopeKind): { ok: true; payload: JsonMap } | { ok: false; error: string } => {
  const attributes = sanitizeAttributes(body.attributes);

  if (kind === "trace") {
    const traceId = toString(body.traceId);
    const operation = toString(body.operation);
    if (!traceId || !operation) return { ok: false, error: "trace_id_and_operation_required" };
    return {
      ok: true,
      payload: {
        traceId,
        operation,
        spanId: toString(body.spanId) ?? "root",
        status: toString(body.status) ?? "ok",
        durationMs: toNumber(body.durationMs) ?? 0,
        attributes
      }
    };
  }

  if (kind === "metric") {
    const metricName = toString(body.metricName);
    const value = toNumber(body.value);
    if (!metricName || typeof value !== "number") return { ok: false, error: "metric_name_and_numeric_value_required" };
    return {
      ok: true,
      payload: {
        metricName,
        value,
        unit: toString(body.unit) ?? "count",
        attributes
      }
    };
  }

  const message = toString(body.message);
  if (!message) return { ok: false, error: "log_message_required" };
  return {
    ok: true,
    payload: {
      message,
      attributes
    }
  };
};

const maxSeverity = (left: Severity, right: Severity): Severity =>
  severityRank[left] >= severityRank[right] ? left : right;

const maybeUpsertIncident = (state: ObservabilityState, envelope: EnvelopeRecord): IncidentRecord | undefined => {
  if (envelope.severity !== "error" && envelope.severity !== "critical") return undefined;
  const incidentKey = `${envelope.tenantId}:${envelope.traceId ?? `${envelope.serviceName ?? "unknown-service"}:${envelope.workflowId ?? "*"}`}`;
  const existing = state.incidents.find((item) => item.tenantId === envelope.tenantId && item.key === incidentKey && item.status !== "resolved");
  if (existing) {
    existing.lastSeenAt = envelope.ingestedAt;
    existing.severity = envelope.severity === "critical" ? "critical" : existing.severity;
    if (!existing.envelopeIds.includes(envelope.envelopeId)) {
      existing.envelopeIds.push(envelope.envelopeId);
    }
    return existing;
  }

  const created: IncidentRecord = {
    incidentId: `inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: envelope.tenantId,
    key: incidentKey,
    status: "open",
    severity: envelope.severity,
    title: `Observability incident on ${envelope.serviceName ?? "unknown-service"}`,
    ...(envelope.traceId ? { traceId: envelope.traceId } : {}),
    ...(envelope.serviceName ? { serviceName: envelope.serviceName } : {}),
    ...(envelope.workflowId ? { workflowId: envelope.workflowId } : {}),
    firstSeenAt: envelope.ingestedAt,
    lastSeenAt: envelope.ingestedAt,
    envelopeIds: [envelope.envelopeId]
  };
  state.incidents.push(created);
  return created;
};

const buildTraceSummaries = (envelopes: EnvelopeRecord[]) => {
  const map = new Map<string, {
    traceId: string;
    tenantId: string;
    serviceName?: string;
    workflowId?: string;
    firstSeenAt: string;
    lastSeenAt: string;
    envelopeCount: number;
    maxSeverity: Severity;
  }>();

  for (const envelope of envelopes) {
    if (!envelope.traceId) continue;
    const current = map.get(envelope.traceId);
    if (!current) {
      map.set(envelope.traceId, {
        traceId: envelope.traceId,
        tenantId: envelope.tenantId,
        ...(envelope.serviceName ? { serviceName: envelope.serviceName } : {}),
        ...(envelope.workflowId ? { workflowId: envelope.workflowId } : {}),
        firstSeenAt: envelope.ingestedAt,
        lastSeenAt: envelope.ingestedAt,
        envelopeCount: 1,
        maxSeverity: envelope.severity
      });
      continue;
    }
    current.envelopeCount += 1;
    current.lastSeenAt = current.lastSeenAt < envelope.ingestedAt ? envelope.ingestedAt : current.lastSeenAt;
    current.maxSeverity = maxSeverity(current.maxSeverity, envelope.severity);
    if (!current.serviceName && envelope.serviceName) current.serviceName = envelope.serviceName;
    if (!current.workflowId && envelope.workflowId) current.workflowId = envelope.workflowId;
  }

  return Array.from(map.values()).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
};

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
    const chain = verifyEnvelopeChain(state.envelopes);
    sendJson(
      response,
      200,
      {
        status: "ok",
        service: descriptor.serviceName,
        envelopes: state.envelopes.length,
        incidents: state.incidents.length,
        openIncidents: state.incidents.filter((item) => item.status === "open").length,
        envelopeChainValid: chain.valid
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/observability/envelopes") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["observability_ingest", "system_service", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const kind = toKind(body.kind);
    if (!kind) {
      sendJson(response, 400, { error: "kind_required" }, secured.requestId);
      return;
    }
    const parsedPayload = parseEnvelopePayload(body, kind);
    if (!parsedPayload.ok) {
      sendJson(response, 400, { error: parsedPayload.error }, secured.requestId);
      return;
    }

    const occurredAt = toIsoOrNow(body.timestamp);
    const envelopeWithoutHash: Omit<EnvelopeRecord, "hash"> = {
      envelopeId: `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: secured.tenantId!,
      actorId: secured.actorId!,
      kind,
      severity: toSeverity(body.severity),
      ingestedAt: nowIso(),
      occurredAt,
      ...(toString(body.traceId) ? { traceId: toString(body.traceId)! } : {}),
      ...(toString(body.serviceName) ? { serviceName: toString(body.serviceName)! } : {}),
      ...(toString(body.workflowId) ? { workflowId: toString(body.workflowId)! } : {}),
      payload: parsedPayload.payload
    };
    const state = await loadState();
    const previousHash = state.envelopes.length > 0 ? state.envelopes[state.envelopes.length - 1]!.hash : undefined;
    const withHashInput = {
      ...envelopeWithoutHash,
      ...(previousHash ? { prevHash: previousHash } : {})
    };
    const envelope: EnvelopeRecord = {
      ...withHashInput,
      hash: sha256Hex(stableSerialize(canonicalEnvelopePayload(withHashInput)))
    };
    state.envelopes.push(envelope);
    const incident = maybeUpsertIncident(state, envelope);
    await saveState(state);
    sendJson(
      response,
      201,
      {
        envelope,
        ...(incident ? { incident } : {})
      },
      secured.requestId
    );
    return;
  }

  if (method === "GET" && path === "/v1/observability/traces") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["analyst", "auditor", "security_admin", "platform_admin", "workflow_operator"] },
      context
    );
    if (!secured) return;
    const queryTenantId = toString(parsedUrl.searchParams.get("tenantId") ?? undefined) ?? secured.tenantId!;
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, queryTenantId, secured.roles)) return;
    const severityFilter = toString(parsedUrl.searchParams.get("severity") ?? undefined);
    const rawLimit = Number(parsedUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;

    const state = await loadState();
    const traces = buildTraceSummaries(state.envelopes.filter((item) => item.tenantId === queryTenantId))
      .filter((item) => {
        if (!severityFilter) return true;
        return item.maxSeverity === severityFilter;
      })
      .slice(0, limit);
    sendJson(response, 200, { traces }, secured.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/observability/incidents") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const queryTenantId = toString(parsedUrl.searchParams.get("tenantId") ?? undefined) ?? secured.tenantId!;
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, queryTenantId, secured.roles)) return;

    const severityFilter = parsedUrl.searchParams.get("severity");
    const statusFilter = parsedUrl.searchParams.get("status");
    const rawLimit = Number(parsedUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;
    const state = await loadState();
    const incidents = state.incidents
      .filter((item) => item.tenantId === queryTenantId)
      .filter((item) => severityFilter === "error" || severityFilter === "critical" ? item.severity === severityFilter : true)
      .filter((item) => statusFilter === "open" || statusFilter === "acknowledged" || statusFilter === "resolved" ? item.status === statusFilter : true)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit);
    sendJson(response, 200, { incidents }, secured.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/observability/metrics/health") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["analyst", "auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const queryTenantId = toString(parsedUrl.searchParams.get("tenantId") ?? undefined) ?? secured.tenantId!;
    if (!enforceTenantScope(response, secured.requestId, secured.tenantId!, queryTenantId, secured.roles)) return;

    const state = await loadState();
    const now = Date.now();
    const tenantEnvelopes = state.envelopes.filter((item) => item.tenantId === queryTenantId);
    const lastFiveMinutes = tenantEnvelopes.filter((item) => Date.parse(item.ingestedAt) >= now - 5 * 60_000);
    const errorsInWindow = lastFiveMinutes.filter((item) => item.severity === "error" || item.severity === "critical").length;
    const byKind = {
      trace: tenantEnvelopes.filter((item) => item.kind === "trace").length,
      metric: tenantEnvelopes.filter((item) => item.kind === "metric").length,
      log: tenantEnvelopes.filter((item) => item.kind === "log").length
    };
    const bySeverity = {
      debug: tenantEnvelopes.filter((item) => item.severity === "debug").length,
      info: tenantEnvelopes.filter((item) => item.severity === "info").length,
      warning: tenantEnvelopes.filter((item) => item.severity === "warning").length,
      error: tenantEnvelopes.filter((item) => item.severity === "error").length,
      critical: tenantEnvelopes.filter((item) => item.severity === "critical").length
    };
    const chain = verifyEnvelopeChain(tenantEnvelopes);
    sendJson(
      response,
      200,
      {
        tenantId: queryTenantId,
        generatedAt: nowIso(),
        totals: {
          envelopes: tenantEnvelopes.length,
          incidents: state.incidents.filter((item) => item.tenantId === queryTenantId).length,
          openIncidents: state.incidents.filter((item) => item.tenantId === queryTenantId && item.status === "open").length
        },
        byKind,
        bySeverity,
        windows: {
          fiveMinutes: {
            envelopes: lastFiveMinutes.length,
            errors: errorsInWindow,
            errorRate: lastFiveMinutes.length === 0 ? 0 : Number((errorsInWindow / lastFiveMinutes.length).toFixed(4))
          }
        },
        integrity: chain
      },
      secured.requestId
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
