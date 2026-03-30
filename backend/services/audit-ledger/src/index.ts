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
import type { AuditEvidence } from "./evidence.js";

export const descriptor: ServiceDescriptor = {
  serviceName: "audit-ledger",
  listeningPort: Number(process.env.PORT ?? 3012),
  purpose: "Immutable evidence ledger and replay index",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

interface AuditLedgerState {
  version: number;
  entries: AuditEvidence[];
}

const stateFile = resolve(process.cwd(), ".volumes", "audit-ledger-state.json");
const limiter = new InMemoryRateLimiter(120, 60_000);

const normalizeState = (state: Partial<AuditLedgerState> | undefined): AuditLedgerState => ({
  version: 1,
  entries: Array.isArray(state?.entries) ? state.entries : []
});

const loadState = async (): Promise<AuditLedgerState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<AuditLedgerState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: AuditLedgerState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const canonicalHashPayload = (entry: {
  evidenceId: string;
  executionId: string;
  tenantId: string;
  actorId: string;
  dataSources: string[];
  policyIds: string[];
  modelRoute?: { provider: string; modelId: string; traceId: string };
  toolCalls: Array<{ toolId: string; callId: string; status: "completed" | "blocked" | "failed" }>;
  approvals: Array<{ approvalId: string; approverId: string; decision: "approved" | "rejected"; timestamp: string }>;
  outputClassification: string;
  blocked: boolean;
  finalDisposition: "completed" | "blocked" | "failed" | "killed";
  prevHash?: string;
}) => ({
  evidenceId: entry.evidenceId,
  executionId: entry.executionId,
  tenantId: entry.tenantId,
  actorId: entry.actorId,
  dataSources: entry.dataSources,
  policyIds: entry.policyIds,
  modelRoute: entry.modelRoute ?? null,
  toolCalls: entry.toolCalls,
  approvals: entry.approvals,
  outputClassification: entry.outputClassification,
  blocked: entry.blocked,
  finalDisposition: entry.finalDisposition,
  prevHash: entry.prevHash ?? null
});

const verifyChain = (entries: AuditEvidence[]) => {
  if (entries.length === 0) return { valid: true, lastHash: undefined };
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]!;
    const expectedHash = sha256Hex(stableSerialize(canonicalHashPayload(current)));
    if (expectedHash !== current.hash) return { valid: false, index, reason: "hash_mismatch" };
    if (index > 0 && current.prevHash !== entries[index - 1]!.hash) {
      return { valid: false, index, reason: "prev_hash_mismatch" };
    }
  }
  return { valid: true, lastHash: entries[entries.length - 1]!.hash };
};

const buildEvidence = (
  tenantId: string,
  actorId: string,
  body: JsonMap,
  prevHash: string | undefined
): AuditEvidence => {
  const evidenceId = toString(body.evidenceId) ?? `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const modelRoute =
    typeof body.modelRoute === "object" && body.modelRoute !== null
      ? (body.modelRoute as { provider: string; modelId: string; traceId: string })
      : undefined;
  const payload: Omit<AuditEvidence, "hash"> = {
    evidenceId,
    executionId: toString(body.executionId) ?? "unknown-execution",
    actorId,
    tenantId,
    dataSources: toStringArray(body.dataSources),
    policyIds: toStringArray(body.policyIds),
    toolCalls:
      Array.isArray(body.toolCalls)
        ? body.toolCalls.filter((item): item is { toolId: string; callId: string; status: "completed" | "blocked" | "failed" } => {
            if (!item || typeof item !== "object") return false;
            const record = item as Record<string, unknown>;
            return (
              typeof record.toolId === "string" &&
              typeof record.callId === "string" &&
              (record.status === "completed" || record.status === "blocked" || record.status === "failed")
            );
          })
        : [],
    approvals:
      Array.isArray(body.approvals)
        ? body.approvals.filter((item): item is { approvalId: string; approverId: string; decision: "approved" | "rejected"; timestamp: string } => {
            if (!item || typeof item !== "object") return false;
            const record = item as Record<string, unknown>;
            return (
              typeof record.approvalId === "string" &&
              typeof record.approverId === "string" &&
              (record.decision === "approved" || record.decision === "rejected") &&
              typeof record.timestamp === "string"
            );
          })
        : [],
    outputClassification: toString(body.outputClassification) ?? "INTERNAL",
    blocked: body.blocked === true,
    finalDisposition:
      body.finalDisposition === "blocked" ||
      body.finalDisposition === "failed" ||
      body.finalDisposition === "killed"
        ? body.finalDisposition
        : "completed"
  };
  if (modelRoute) payload.modelRoute = modelRoute;
  if (prevHash) payload.prevHash = prevHash;
  const hash = sha256Hex(stableSerialize(canonicalHashPayload(payload)));
  return {
    ...payload,
    hash
  };
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
    const verification = verifyChain(state.entries);
    sendJson(
      response,
      200,
      {
        status: "ok",
        service: descriptor.serviceName,
        entries: state.entries.length,
        chainValid: verification.valid
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/audit/evidence") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const state = await loadState();
    const prevHash = state.entries.length > 0 ? state.entries[state.entries.length - 1]!.hash : undefined;
    const evidence = buildEvidence(secured.tenantId ?? "unknown", secured.actorId ?? "unknown", body, prevHash);
    state.entries.push(evidence);
    await saveState(state);
    sendJson(response, 201, evidence, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/audit/evidence") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    const limitRaw = Number(parsedUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
    const entries = state.entries.filter((entry) => entry.tenantId === secured.tenantId).slice().reverse().slice(0, limit);
    sendJson(response, 200, { entries }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/audit\/evidence\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const evidenceId = path.split("/")[4] ?? "";
    const state = await loadState();
    const entry = state.entries.find((item) => item.evidenceId === evidenceId && item.tenantId === secured.tenantId);
    if (!entry) {
      sendJson(response, 404, { error: "evidence_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, entry, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/audit/verify-chain") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    const entries = state.entries.filter((entry) => entry.tenantId === secured.tenantId);
    const verification = verifyChain(entries);
    sendJson(response, 200, verification, context.requestId);
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
