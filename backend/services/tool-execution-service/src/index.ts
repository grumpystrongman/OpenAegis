import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import {
  InMemoryRateLimiter,
  enforceRateLimit,
  enforceSecurity,
  parseContext,
  readJson,
  sendJson,
  sha256Hex,
  stableSerialize,
  type JsonMap
} from "@openaegis/security-kit";
import { enforceToolCallGuard, type ToolManifest } from "./runtime-policy.js";

export const descriptor: ServiceDescriptor = {
  serviceName: "tool-execution-service",
  listeningPort: 3007,
  purpose: "Sandboxed tool dispatch and evidence collection",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type ToolAction = "READ" | "WRITE" | "EXECUTE";
type RunMode = "simulate" | "execute";

interface ToolCallRecord {
  toolCallId: string;
  toolId: string;
  mode: RunMode;
  action: ToolAction;
  requestedNetworkProfile: string;
  actorId: string;
  tenantId: string;
  idempotencyKey?: string;
  requestHash: string;
  status: "completed" | "blocked";
  guardReason?: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
}

interface ExecutionState {
  version: number;
  calls: ToolCallRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "tool-execution-state.json");
const now = () => new Date().toISOString();

const runtimeManifests: ToolManifest[] = [
  {
    toolId: "connector-fhir-read",
    version: "1.0.0",
    signature: "sig-fhir-v1",
    allowedActions: ["READ"],
    networkProfiles: ["clinical-internal"]
  },
  {
    toolId: "connector-sql-careplan",
    version: "1.0.0",
    signature: "sig-sql-v1",
    allowedActions: ["READ"],
    networkProfiles: ["clinical-internal"]
  },
  {
    toolId: "connector-email-notify",
    version: "1.0.0",
    signature: "sig-email-v1",
    allowedActions: ["EXECUTE"],
    networkProfiles: ["outbound-approved"]
  },
  {
    toolId: "connector-linear-project",
    version: "1.0.0",
    signature: "sig-linear-v1",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    networkProfiles: ["project-ops"]
  }
];

const loadState = async (): Promise<ExecutionState> => {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as Partial<ExecutionState>;
    return {
      version: 1,
      calls: Array.isArray(parsed.calls) ? parsed.calls : []
    };
  } catch {
    return { version: 1, calls: [] };
  }
};

const saveState = async (state: ExecutionState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toAction = (value: unknown): ToolAction | undefined => {
  if (value === "READ" || value === "WRITE" || value === "EXECUTE") return value;
  return undefined;
};

const toMode = (value: unknown): RunMode => (value === "execute" ? "execute" : "simulate");

const getManifest = (toolId: string): ToolManifest | undefined =>
  runtimeManifests.find((manifest) => manifest.toolId === toolId);

const buildResult = (toolId: string, mode: RunMode, parameters: Record<string, unknown>) => {
  if (toolId === "connector-linear-project") {
    return {
      operation: mode === "simulate" ? "mock_linear_issue_write" : "linear_issue_write",
      output: {
        issueKey: `LIN-${Math.floor(Math.random() * 900 + 100)}`,
        status: "created",
        tags: ["openaegis", "connector", "audit"]
      },
      echoedParameters: parameters
    };
  }

  return {
    operation: mode === "simulate" ? "mock_execution" : "live_execution",
    output: {
      summary: `Tool ${toolId} ${mode === "simulate" ? "simulated" : "executed"} successfully`
    },
    echoedParameters: parameters
  };
};

const buildCallId = () => `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const limiter = new InMemoryRateLimiter(120, 60_000);

const viewRoles = ["workflow_operator", "security_admin", "platform_admin", "auditor", "approver", "clinician"];
const writeExecuteRoles = ["workflow_operator", "security_admin", "platform_admin"];
const readRoles = [...writeExecuteRoles, "clinician", "data_analyst"];

const hasAnyRole = (roles: string[], allowed: string[]) => allowed.some((role) => roles.includes(role));

const toRequestHash = (input: {
  toolId: string;
  action: ToolAction;
  mode: RunMode;
  requestedNetworkProfile: string;
  tenantId: string;
  actorId: string;
  requiresApproval: boolean;
  approvalGranted: boolean;
  stepBudgetRemaining: number;
  parameters: Record<string, unknown>;
}) => sha256Hex(stableSerialize(input));

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsed = new URL(request.url ?? "/", "http://localhost");
  const pathname = parsed.pathname;
  const context = parseContext(request);
  if (!enforceRateLimit(response, context.requestId, limiter.check(`${request.socket.remoteAddress ?? "unknown"}:${pathname}`))) {
    return;
  }

  if (method === "GET" && pathname === "/healthz") {
    const state = await loadState();
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, calls: state.calls.length }, context.requestId);
    return;
  }

  if (method === "GET" && pathname === "/v1/tool-calls") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: viewRoles },
      context
    );
    if (!secured) return;
    const state = await loadState();
    const calls = secured.roles.includes("platform_admin")
      ? state.calls.slice().reverse()
      : state.calls.filter((call) => call.tenantId === secured.tenantId).slice().reverse();
    sendJson(response, 200, { calls }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/tool-calls\/[^/]+$/.test(pathname)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: viewRoles },
      context
    );
    if (!secured) return;
    const callId = pathname.split("/")[3] ?? "";
    const state = await loadState();
    const call = state.calls.find((item) => item.toolCallId === callId);
    if (!call || (!secured.roles.includes("platform_admin") && call.tenantId !== secured.tenantId)) {
      sendJson(response, 404, { error: "tool_call_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, call, context.requestId);
    return;
  }

  if (method === "POST" && pathname === "/v1/tool-calls") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const toolId = toString(body.toolId);
    const action = toAction(body.action);
    const mode = toMode(body.mode);
    const requestedNetworkProfile = toString(body.requestedNetworkProfile) ?? "clinical-internal";
    const actorId = secured.actorId ?? "unknown";
    const tenantId = secured.tenantId ?? "unknown";
    const idempotencyKey = toString(request.headers["idempotency-key"]) ?? toString(body.idempotencyKey);
    const stepBudgetRemaining = typeof body.stepBudgetRemaining === "number" ? body.stepBudgetRemaining : 1;
    const requiresApproval = body.requiresApproval === true;
    const approvalGranted = body.approvalGranted === true;
    const parameters = (typeof body.parameters === "object" && body.parameters !== null
      ? body.parameters
      : {}) as Record<string, unknown>;

    if (!toolId || !action) {
      sendJson(response, 400, { error: "tool_id_and_action_required" }, context.requestId);
      return;
    }

    const allowedRoles = action === "READ" ? readRoles : writeExecuteRoles;
    if (!hasAnyRole(secured.roles, allowedRoles)) {
      sendJson(response, 403, { error: "insufficient_role_for_tool_action" }, context.requestId);
      return;
    }

    if (mode === "execute" && !idempotencyKey) {
      sendJson(response, 400, { error: "idempotency_key_required_for_live_execute" }, context.requestId);
      return;
    }

    const manifest = getManifest(toolId);
    if (!manifest) {
      sendJson(response, 404, { error: "tool_manifest_not_found" }, context.requestId);
      return;
    }

    const requestHash = toRequestHash({
      toolId,
      action,
      mode,
      requestedNetworkProfile,
      tenantId,
      actorId,
      requiresApproval,
      approvalGranted,
      stepBudgetRemaining,
      parameters
    });

    const state = await loadState();
    if (idempotencyKey) {
      const existing = state.calls.find(
        (call) =>
          call.idempotencyKey === idempotencyKey &&
          call.toolId === toolId &&
          call.action === action &&
          call.tenantId === tenantId
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          sendJson(response, 409, { error: "idempotency_key_reuse_mismatch" }, context.requestId);
          return;
        }
        sendJson(response, 200, { ...existing, idempotentReplay: true }, context.requestId);
        return;
      }
    }

    const guard = enforceToolCallGuard(manifest, {
      action,
      requestedNetworkProfile,
      stepBudgetRemaining,
      requiresApproval,
      approvalGranted
    });

    if (!guard.allowed) {
      const blocked: ToolCallRecord = {
        toolCallId: buildCallId(),
        toolId,
        mode,
        action,
        requestedNetworkProfile,
        actorId,
        tenantId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        requestHash,
        status: "blocked",
        guardReason: guard.reason ?? "blocked",
        parameters,
        result: { blocked: true },
        createdAt: now()
      };
      state.calls.push(blocked);
      await saveState(state);
      sendJson(response, 403, blocked, context.requestId);
      return;
    }

    const completed: ToolCallRecord = {
      toolCallId: buildCallId(),
      toolId,
      mode,
      action,
      requestedNetworkProfile,
      actorId,
      tenantId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      requestHash,
      status: "completed",
      parameters,
      result: buildResult(toolId, mode, parameters),
      createdAt: now()
    };

    state.calls.push(completed);
    await saveState(state);
    sendJson(response, 200, completed, context.requestId);
    return;
  }

  sendJson(response, 404, { error: "not_found", service: descriptor.serviceName, path: pathname }, context.requestId);
};

export const createAppServer = () =>
  createServer((request, response) => {
    void requestHandler(request, response).catch((error: unknown) => {
      const requestId = parseContext(request).requestId;
      if (error instanceof Error && error.message === "payload_too_large") {
        sendJson(response, 413, { error: "payload_too_large" }, requestId);
        return;
      }
      sendJson(
        response,
        500,
        { error: "internal_error", message: error instanceof Error ? error.message : "unknown" },
        requestId
      );
    });
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(descriptor.serviceName + " listening on :" + descriptor.listeningPort);
  });
}

