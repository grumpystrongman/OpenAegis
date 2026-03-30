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

export const descriptor: ServiceDescriptor = {
  serviceName: "agent-registry",
  listeningPort: 3005,
  purpose: "Agent definitions, versions, and signing metadata",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type AgentStatus = "draft" | "active" | "suspended";

interface AgentVersion {
  version: string;
  signedBy: string;
  signedAt: string;
  signingKeyId: string;
  digest: string;
}

interface AgentRecord {
  agentId: string;
  tenantId: string;
  name: string;
  description: string;
  owner: string;
  status: AgentStatus;
  sandboxProfile: string;
  toolScopes: string[];
  budget: {
    stepLimit: number;
    maxRuntimeSeconds: number;
    retryLimit: number;
  };
  versions: AgentVersion[];
  createdAt: string;
  updatedAt: string;
}

interface RegistryState {
  version: number;
  agents: AgentRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "agent-registry-state.json");
const limiter = new InMemoryRateLimiter(120, 60_000);

const seedAgents = (): AgentRecord[] => {
  const now = nowIso();
  return [
    {
      agentId: "agent-discharge-planner",
      tenantId: "tenant-starlight-health",
      name: "Discharge Planner",
      description: "Drafts patient discharge summaries from FHIR and task data.",
      owner: "clinical-ops",
      status: "active",
      sandboxProfile: "no-network-default",
      toolScopes: ["fhir.read", "sql.read", "model.infer"],
      budget: { stepLimit: 12, maxRuntimeSeconds: 45, retryLimit: 1 },
      versions: [
        {
          version: "1.0.0",
          signedBy: "system-bootstrap",
          signedAt: now,
          signingKeyId: "agent-registry-kid-main",
          digest: sha256Hex("agent-discharge-planner@1.0.0")
        }
      ],
      createdAt: now,
      updatedAt: now
    },
    {
      agentId: "agent-approval-guardian",
      tenantId: "tenant-starlight-health",
      name: "Approval Guardian",
      description: "Classifies outbound actions and keeps risky steps blocked until review.",
      owner: "security-engineering",
      status: "active",
      sandboxProfile: "egress-deny",
      toolScopes: ["policy.evaluate", "approval.create", "audit.write"],
      budget: { stepLimit: 8, maxRuntimeSeconds: 20, retryLimit: 0 },
      versions: [
        {
          version: "1.0.0",
          signedBy: "system-bootstrap",
          signedAt: now,
          signingKeyId: "agent-registry-kid-main",
          digest: sha256Hex("agent-approval-guardian@1.0.0")
        }
      ],
      createdAt: now,
      updatedAt: now
    },
    {
      agentId: "agent-audit-scribe",
      tenantId: "tenant-starlight-health",
      name: "Audit Scribe",
      description: "Normalizes evidence and replay metadata for the audit ledger.",
      owner: "platform-governance",
      status: "draft",
      sandboxProfile: "read-only",
      toolScopes: ["audit.read", "object.write"],
      budget: { stepLimit: 8, maxRuntimeSeconds: 30, retryLimit: 1 },
      versions: [
        {
          version: "0.9.0",
          signedBy: "system-bootstrap",
          signedAt: now,
          signingKeyId: "agent-registry-kid-main",
          digest: sha256Hex("agent-audit-scribe@0.9.0")
        }
      ],
      createdAt: now,
      updatedAt: now
    }
  ];
};

const normalizeState = (state: Partial<RegistryState> | undefined): RegistryState => ({
  version: 1,
  agents: Array.isArray(state?.agents) && state.agents.length > 0 ? state.agents : seedAgents()
});

const loadState = async (): Promise<RegistryState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<RegistryState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: RegistryState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const isAdmin = (roles: string[]) => roles.includes("platform_admin") || roles.includes("security_admin");

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

const toStatus = (value: unknown): AgentStatus =>
  value === "draft" || value === "suspended" || value === "active" ? value : "draft";

const summarizeHealth = (agents: AgentRecord[]) => {
  const counts = agents.reduce(
    (accumulator, agent) => {
      accumulator.total += 1;
      accumulator[agent.status] += 1;
      accumulator.versions += agent.versions.length;
      accumulator.tenants.add(agent.tenantId);
      accumulator.updatedAt = agent.updatedAt > accumulator.updatedAt ? agent.updatedAt : accumulator.updatedAt;
      return accumulator;
    },
    {
      total: 0,
      draft: 0,
      active: 0,
      suspended: 0,
      versions: 0,
      tenants: new Set<string>(),
      updatedAt: ""
    }
  );

  return {
    totalAgents: counts.total,
    draftAgents: counts.draft,
    activeAgents: counts.active,
    suspendedAgents: counts.suspended,
    versionCount: counts.versions,
    tenantCount: counts.tenants.size,
    lastUpdatedAt: counts.updatedAt || null
  };
};

const findAgent = (agents: AgentRecord[], tenantId: string, agentId: string) =>
  agents.find((agent) => agent.tenantId === tenantId && agent.agentId === agentId);

const buildAgentDigest = (agent: Pick<AgentRecord, "agentId" | "name" | "description" | "status" | "sandboxProfile" | "budget" | "toolScopes">) =>
  sha256Hex(
    JSON.stringify({
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description,
      status: agent.status,
      sandboxProfile: agent.sandboxProfile,
      budget: agent.budget,
      toolScopes: agent.toolScopes
    })
  );

const registerVersion = (agent: AgentRecord, actorId: string): AgentRecord => {
  const nextVersion = `${agent.versions.length + 1}.0.0`;
  const version: AgentVersion = {
    version: nextVersion,
    signedBy: actorId,
    signedAt: nowIso(),
    signingKeyId: "agent-registry-kid-main",
    digest: buildAgentDigest(agent)
  };
  return {
    ...agent,
    versions: [...agent.versions, version],
    updatedAt: version.signedAt
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
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, ...summarizeHealth(state.agents) }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/agents") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin", "auditor"] },
      context
    );
    if (!secured) return;

    const state = await loadState();
    const agents = state.agents
      .filter((agent) => agent.tenantId === secured.tenantId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.agentId.localeCompare(right.agentId));
    sendJson(response, 200, { agents, metrics: summarizeHealth(agents) }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/agents\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin", "auditor"] },
      context
    );
    if (!secured) return;
    const agentId = path.split("/")[3] ?? "";
    const state = await loadState();
    const agent = findAgent(state.agents, secured.tenantId ?? "", agentId);
    if (!agent) {
      sendJson(response, 404, { error: "agent_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, agent, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/agents") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const agentId = toString(body.agentId);
    const name = toString(body.name);
    const description = toString(body.description);
    const owner = toString(body.owner);
    if (!agentId || !name || !description || !owner) {
      sendJson(response, 400, { error: "missing_required_agent_fields" }, context.requestId);
      return;
    }

    const state = await loadState();
    if (findAgent(state.agents, secured.tenantId ?? "", agentId)) {
      sendJson(response, 409, { error: "agent_exists" }, context.requestId);
      return;
    }

    const now = nowIso();
    const record: AgentRecord = {
      agentId,
      tenantId: secured.tenantId ?? "unknown",
      name,
      description,
      owner,
      status: toStatus(body.status),
      sandboxProfile: toString(body.sandboxProfile) ?? "no-network-default",
      toolScopes: toStringArray(body.toolScopes),
      budget: {
        stepLimit: toNumber(typeof body.budget === "object" && body.budget !== null ? (body.budget as JsonMap).stepLimit : undefined, 8),
        maxRuntimeSeconds: toNumber(
          typeof body.budget === "object" && body.budget !== null ? (body.budget as JsonMap).maxRuntimeSeconds : undefined,
          30
        ),
        retryLimit: Math.max(
          0,
          Math.floor(
            typeof body.budget === "object" && body.budget !== null && typeof (body.budget as JsonMap).retryLimit === "number"
              ? ((body.budget as JsonMap).retryLimit as number)
              : 1
          )
        )
      },
      versions: [],
      createdAt: now,
      updatedAt: now
    };

    const versioned = registerVersion(record, secured.actorId ?? "unknown");
    state.agents.push(versioned);
    await saveState(state);
    sendJson(response, 201, versioned, context.requestId);
    return;
  }

  if (method === "PATCH" && /^\/v1\/agents\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const agentId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.agents.findIndex((agent) => agent.tenantId === secured.tenantId && agent.agentId === agentId);
    if (index < 0) {
      sendJson(response, 404, { error: "agent_not_found" }, context.requestId);
      return;
    }

    const body = await readJson(request);
    const current = state.agents[index]!;
    const patched: AgentRecord = {
      ...current,
      ...(toString(body.name) ? { name: toString(body.name)! } : {}),
      ...(toString(body.description) ? { description: toString(body.description)! } : {}),
      ...(toString(body.owner) ? { owner: toString(body.owner)! } : {}),
      ...(body.status ? { status: toStatus(body.status) } : {}),
      ...(toString(body.sandboxProfile) ? { sandboxProfile: toString(body.sandboxProfile)! } : {}),
      ...(Array.isArray(body.toolScopes) ? { toolScopes: toStringArray(body.toolScopes) } : {}),
      ...(typeof body.budget === "object" && body.budget !== null
        ? {
            budget: {
              stepLimit: toNumber((body.budget as JsonMap).stepLimit, current.budget.stepLimit),
              maxRuntimeSeconds: toNumber((body.budget as JsonMap).maxRuntimeSeconds, current.budget.maxRuntimeSeconds),
              retryLimit: Math.max(
                0,
                Math.floor(
                  typeof (body.budget as JsonMap).retryLimit === "number"
                    ? ((body.budget as JsonMap).retryLimit as number)
                    : current.budget.retryLimit
                )
              )
            }
          }
        : {})
    };

    const versioned = registerVersion(patched, secured.actorId ?? "unknown");
    state.agents[index] = versioned;
    await saveState(state);
    sendJson(response, 200, versioned, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/admin/metrics") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    const agents = state.agents.filter((agent) => agent.tenantId === secured.tenantId);
    sendJson(response, 200, { service: descriptor.serviceName, tenantId: secured.tenantId, ...summarizeHealth(agents) }, context.requestId);
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

