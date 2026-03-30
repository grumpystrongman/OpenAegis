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
  serviceName: "approval-service",
  listeningPort: Number(process.env.PORT ?? 3011),
  purpose: "Human approvals, escalation and dual-control",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type ApprovalDecision = "approved" | "rejected";
type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

interface ApprovalRecord {
  approvalId: string;
  tenantId: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  riskLevel: "high" | "critical";
  reason: string;
  requiredApprovers: number;
  status: ApprovalStatus;
  approvers: Array<{
    approverId: string;
    decision: ApprovalDecision;
    reason?: string;
    decidedAt: string;
  }>;
  metadata: Record<string, unknown>;
}

interface ApprovalState {
  version: number;
  approvals: ApprovalRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "approval-service-state.json");
const limiter = new InMemoryRateLimiter(90, 60_000);

const normalizeState = (state: Partial<ApprovalState> | undefined): ApprovalState => ({
  version: 1,
  approvals: Array.isArray(state?.approvals) ? state.approvals : []
});

const loadState = async (): Promise<ApprovalState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<ApprovalState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: ApprovalState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const updateStatus = (approval: ApprovalRecord): ApprovalStatus => {
  if (Date.now() > new Date(approval.expiresAt).getTime()) return "expired";
  if (approval.approvers.some((item) => item.decision === "rejected")) return "rejected";
  const approvedCount = approval.approvers.filter((item) => item.decision === "approved").length;
  if (approvedCount >= approval.requiredApprovers) return "approved";
  return "pending";
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
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, approvals: state.approvals.length }, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/approvals") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const reason = toString(body.reason);
    const riskLevel = body.riskLevel === "critical" ? "critical" : "high";
    const ttlSecondsRaw = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 4 * 60 * 60;
    const ttlSeconds = Math.max(60, Math.min(24 * 60 * 60, Math.floor(ttlSecondsRaw)));
    if (!reason) {
      sendJson(response, 400, { error: "reason_required" }, context.requestId);
      return;
    }

    const approval: ApprovalRecord = {
      approvalId: `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: secured.tenantId ?? "unknown",
      requestedBy: secured.actorId ?? "unknown",
      requestedAt: nowIso(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      riskLevel,
      reason,
      requiredApprovers: riskLevel === "critical" ? 2 : 1,
      status: "pending",
      approvers: [],
      metadata: typeof body.metadata === "object" && body.metadata !== null ? (body.metadata as Record<string, unknown>) : {}
    };
    const state = await loadState();
    state.approvals.push(approval);
    await saveState(state);
    sendJson(response, 201, approval, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/approvals") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const state = await loadState();
    const approvals = state.approvals
      .filter((approval) => approval.tenantId === secured.tenantId)
      .map((approval) => ({ ...approval, status: updateStatus(approval) }))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    sendJson(response, 200, { approvals }, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/approvals\/[^/]+\/decide$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["approver", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const approvalId = path.split("/")[3] ?? "";
    const body = await readJson(request);
    const decision: ApprovalDecision = body.decision === "reject" || body.decision === "rejected" ? "rejected" : "approved";
    const reason = toString(body.reason);
    const state = await loadState();
    const approval = state.approvals.find((item) => item.approvalId === approvalId && item.tenantId === secured.tenantId);
    if (!approval) {
      sendJson(response, 404, { error: "approval_not_found" }, context.requestId);
      return;
    }

    approval.approvers = approval.approvers.filter((entry) => entry.approverId !== secured.actorId);
    approval.approvers.push({
      approverId: secured.actorId ?? "unknown",
      decision,
      ...(reason ? { reason } : {}),
      decidedAt: nowIso()
    });
    approval.status = updateStatus(approval);
    await saveState(state);
    sendJson(response, 200, approval, context.requestId);
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
