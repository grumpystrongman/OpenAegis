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
  type JsonMap
} from "@openaegis/security-kit";

type ExecutionState = "queued" | "running" | "blocked" | "completed" | "failed" | "killed";

interface ExecutionCheckpoint {
  executionId: string;
  stepNumber: number;
  stateHash: string;
  createdAt: string;
}

interface ExecutionContext {
  executionId: string;
  state: ExecutionState;
  stepBudgetRemaining: number;
  retryBudgetRemaining: number;
  checkpoints: ExecutionCheckpoint[];
}

const transitionExecution = (
  context: ExecutionContext,
  event: "start" | "step_succeeded" | "step_failed" | "blocked" | "kill" | "complete"
): ExecutionContext => {
  if (event === "start" && context.state === "queued") {
    return { ...context, state: "running" };
  }

  if (event === "blocked") {
    return { ...context, state: "blocked" };
  }

  if (event === "kill") {
    return { ...context, state: "killed" };
  }

  if (event === "complete") {
    return { ...context, state: "completed" };
  }

  if (event === "step_failed") {
    const retries = context.retryBudgetRemaining - 1;
    return { ...context, retryBudgetRemaining: retries, state: retries >= 0 ? "running" : "failed" };
  }

  return context;
};

export const descriptor: ServiceDescriptor = {
  serviceName: "workflow-orchestrator",
  listeningPort: 3004,
  purpose: "Deterministic workflow state machine and checkpointing",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

interface WorkflowDefinition {
  workflowId: string;
  name: string;
  description: string;
  allowedRoles: string[];
  stepBudget: number;
  tokenBudget: number;
  maxRuntimeSeconds: number;
  status: "active" | "draft" | "disabled";
  version: string;
}

interface StepCheckpoint {
  stepNumber: number;
  stateHash: string;
  note: string;
  createdAt: string;
}

interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  tenantId: string;
  actorId: string;
  mode: "simulation" | "live";
  state: ExecutionState;
  stepBudgetRemaining: number;
  retryBudgetRemaining: number;
  checkpoints: StepCheckpoint[];
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface OrchestratorState {
  version: number;
  workflows: WorkflowDefinition[];
  executions: WorkflowExecution[];
}

const stateFile = resolve(process.cwd(), ".volumes", "workflow-orchestrator-state.json");
const limiter = new InMemoryRateLimiter(100, 60_000);

const seedWorkflows = (): WorkflowDefinition[] => [
  {
    workflowId: "wf-discharge-assistant",
    name: "Discharge Readiness Assistant",
    description: "Reads clinical context, drafts discharge material, and gates high-risk outbound communication.",
    allowedRoles: ["workflow_operator", "security_admin", "platform_admin"],
    stepBudget: 12,
    tokenBudget: 4000,
    maxRuntimeSeconds: 60,
    status: "active",
    version: "1.0.0"
  },
  {
    workflowId: "wf-med-reconciliation",
    name: "Medication Reconciliation",
    description: "Reviews medication lists and flags inconsistencies before follow-up.",
    allowedRoles: ["workflow_operator", "security_admin", "platform_admin"],
    stepBudget: 8,
    tokenBudget: 2500,
    maxRuntimeSeconds: 45,
    status: "draft",
    version: "0.1.0"
  }
];

const normalizeState = (state: Partial<OrchestratorState> | undefined): OrchestratorState => ({
  version: 1,
  workflows: Array.isArray(state?.workflows) && state.workflows.length > 0 ? state.workflows : seedWorkflows(),
  executions: Array.isArray(state?.executions) ? state.executions : []
});

const loadState = async (): Promise<OrchestratorState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<OrchestratorState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: OrchestratorState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

const isAdmin = (roles: string[]) => roles.includes("platform_admin") || roles.includes("security_admin");

const isOperator = (roles: string[]) =>
  roles.includes("workflow_operator") || roles.includes("platform_admin") || roles.includes("security_admin");

const findWorkflow = (state: OrchestratorState, workflowId: string) =>
  state.workflows.find((workflow) => workflow.workflowId === workflowId);

const findExecution = (state: OrchestratorState, executionId: string) =>
  state.executions.find((execution) => execution.executionId === executionId);

const updateExecution = (execution: WorkflowExecution, event: "start" | "step_succeeded" | "blocked" | "kill" | "complete") => {
  const next = transitionExecution(
    {
      executionId: execution.executionId,
      state: execution.state,
      stepBudgetRemaining: execution.stepBudgetRemaining,
      retryBudgetRemaining: execution.retryBudgetRemaining,
      checkpoints: execution.checkpoints.map((checkpoint) => ({
        executionId: execution.executionId,
        stepNumber: checkpoint.stepNumber,
        stateHash: checkpoint.stateHash,
        createdAt: checkpoint.createdAt
      }))
    },
    event
  );

  return {
    ...execution,
    state: next.state,
    stepBudgetRemaining: next.stepBudgetRemaining,
    retryBudgetRemaining: next.retryBudgetRemaining
  };
};

const summarizeHealth = (state: OrchestratorState) => {
  const counts = state.executions.reduce<Record<string, number>>((accumulator, execution) => {
    accumulator[execution.state] = (accumulator[execution.state] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    totalWorkflows: state.workflows.length,
    totalExecutions: state.executions.length,
    runningExecutions: counts.running ?? 0,
    blockedExecutions: counts.blocked ?? 0,
    completedExecutions: counts.completed ?? 0,
    failedExecutions: counts.failed ?? 0,
    killedExecutions: counts.killed ?? 0,
    queuedExecutions: counts.queued ?? 0,
    checkpointCount: state.executions.reduce((sum, execution) => sum + execution.checkpoints.length, 0),
    latestExecutionAt: state.executions.reduce((latest, execution) => (execution.updatedAt > latest ? execution.updatedAt : latest), "")
  };
};

const listExecutionsForTenant = (state: OrchestratorState, tenantId: string) =>
  state.executions.filter((execution) => execution.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const createExecutionId = () => `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const checkpointHash = (executionId: string, stepNumber: number, note: string) =>
  sha256Hex(`${executionId}:${stepNumber}:${note}`);

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
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, ...summarizeHealth(state) }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/workflows") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const state = await loadState();
    const executions = listExecutionsForTenant(state, secured.tenantId ?? "");
    sendJson(
      response,
      200,
      {
        workflows: state.workflows,
        executionsByWorkflow: state.workflows.map((workflow) => ({
          workflowId: workflow.workflowId,
          executionCount: executions.filter((execution) => execution.workflowId === workflow.workflowId).length,
          latestExecutionAt: executions.find((execution) => execution.workflowId === workflow.workflowId)?.updatedAt ?? null
        }))
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/workflows") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const workflowId = toString(body.workflowId);
    const name = toString(body.name);
    if (!workflowId || !name) {
      sendJson(response, 400, { error: "missing_required_workflow_fields" }, context.requestId);
      return;
    }

    const state = await loadState();
    if (findWorkflow(state, workflowId)) {
      sendJson(response, 409, { error: "workflow_exists" }, context.requestId);
      return;
    }

    const workflow: WorkflowDefinition = {
      workflowId,
      name,
      description: toString(body.description) ?? "",
      allowedRoles: toStringArray(body.allowedRoles).length > 0 ? toStringArray(body.allowedRoles) : ["workflow_operator"],
      stepBudget: toNumber(body.stepBudget, 8),
      tokenBudget: toNumber(body.tokenBudget, 3000),
      maxRuntimeSeconds: toNumber(body.maxRuntimeSeconds, 60),
      status: body.status === "draft" || body.status === "disabled" ? body.status : "active",
      version: toString(body.version) ?? "1.0.0"
    };
    state.workflows.push(workflow);
    await saveState(state);
    sendJson(response, 201, workflow, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/executions") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const workflowId = toString(body.workflowId);
    if (!workflowId) {
      sendJson(response, 400, { error: "workflow_id_required" }, context.requestId);
      return;
    }

    const state = await loadState();
    const workflow = findWorkflow(state, workflowId);
    if (!workflow) {
      sendJson(response, 404, { error: "workflow_not_found" }, context.requestId);
      return;
    }

    const executionId = createExecutionId();
    const now = nowIso();
    const execution: WorkflowExecution = {
      executionId,
      workflowId,
      tenantId: secured.tenantId ?? "unknown",
      actorId: secured.actorId ?? "unknown",
      mode: body.mode === "live" ? "live" : "simulation",
      state: "queued",
      stepBudgetRemaining: toNumber(body.stepBudget, workflow.stepBudget),
      retryBudgetRemaining: 1,
      checkpoints: [],
      createdAt: now,
      updatedAt: now
    };
    state.executions.push(execution);
    await saveState(state);
    sendJson(response, 201, execution, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/executions\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const state = await loadState();
    const execution = findExecution(state, executionId);
    if (!execution || execution.tenantId !== secured.tenantId) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, execution, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/executions") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const state = await loadState();
    sendJson(response, 200, { executions: listExecutionsForTenant(state, secured.tenantId ?? "") }, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/executions\/[^/]+\/start$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.executions.findIndex((execution) => execution.executionId === executionId && execution.tenantId === secured.tenantId);
    if (index < 0) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    const updated = updateExecution(state.executions[index]!, "start");
    updated.startedAt = updated.startedAt ?? nowIso();
    updated.updatedAt = nowIso();
    state.executions[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/executions\/[^/]+\/checkpoints$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const body = await readJson(request);
    const note = toString(body.note) ?? "step checkpoint";
    const state = await loadState();
    const index = state.executions.findIndex((execution) => execution.executionId === executionId && execution.tenantId === secured.tenantId);
    if (index < 0) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    const current = state.executions[index]!;
    if (current.state !== "running") {
      sendJson(response, 409, { error: "execution_not_running" }, context.requestId);
      return;
    }
    const nextStepNumber = current.checkpoints.length + 1;
    const checkpoint: StepCheckpoint = {
      stepNumber: nextStepNumber,
      stateHash: toString(body.stateHash) ?? checkpointHash(executionId, nextStepNumber, note),
      note,
      createdAt: nowIso()
    };
    const updated: WorkflowExecution = {
      ...current,
      checkpoints: [...current.checkpoints, checkpoint],
      stepBudgetRemaining: current.stepBudgetRemaining - 1,
      updatedAt: checkpoint.createdAt
    };
    if (updated.stepBudgetRemaining < 0) {
      updated.state = "failed";
      updated.blockedReason = "step_budget_exhausted";
    }
    state.executions[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/executions\/[^/]+\/block$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.executions.findIndex((execution) => execution.executionId === executionId && execution.tenantId === secured.tenantId);
    if (index < 0) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    const current = state.executions[index]!;
    const updated: WorkflowExecution = {
      ...current,
      state: "blocked",
      blockedReason: toString((await readJson(request)).reason) ?? "approval_required",
      updatedAt: nowIso()
    };
    state.executions[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/executions\/[^/]+\/complete$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.executions.findIndex((execution) => execution.executionId === executionId && execution.tenantId === secured.tenantId);
    if (index < 0) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    const current = state.executions[index]!;
    const updated: WorkflowExecution = {
      ...current,
      state: "completed",
      completedAt: nowIso(),
      updatedAt: nowIso()
    };
    state.executions[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/executions\/[^/]+\/kill$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const executionId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.executions.findIndex((execution) => execution.executionId === executionId && execution.tenantId === secured.tenantId);
    if (index < 0) {
      sendJson(response, 404, { error: "execution_not_found" }, context.requestId);
      return;
    }
    const current = state.executions[index]!;
    const updated: WorkflowExecution = {
      ...current,
      state: "killed",
      updatedAt: nowIso()
    };
    state.executions[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
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
