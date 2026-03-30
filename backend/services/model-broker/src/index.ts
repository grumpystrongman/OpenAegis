import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import type { DataClass, ServiceDescriptor } from "@openaegis/contracts";
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
  serviceName: "model-broker",
  listeningPort: Number(process.env.PORT ?? 3008),
  purpose: "Vendor-neutral model routing and capability-aware policy evaluation",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type ModelProvider = "openai" | "anthropic" | "google" | "azure" | "self_hosted";
type Capability = "json_schema" | "tool_use" | "vision" | "streaming";
type CostBand = "low" | "medium" | "high";

interface ProviderRecord {
  provider: ModelProvider;
  modelId: string;
  enabled: boolean;
  supportsZeroRetention: boolean;
  capabilities: Capability[];
  contextWindow: number;
  latencyMs: number;
  costBand: CostBand;
  riskTier: "low" | "medium" | "high";
}

interface RouteInput {
  sensitivity: DataClass;
  requiredCapabilities: Capability[];
  zeroRetentionRequired: boolean;
  maxLatencyMs: number;
  costCeiling: CostBand;
  providerAllowList?: ModelProvider[];
}

interface RouteScore {
  cost: number;
  latency: number;
  risk: number;
  total: number;
}

interface RouteDecisionRecord {
  decisionId: string;
  tenantId: string;
  actorId: string;
  input: RouteInput;
  selected: ProviderRecord;
  fallback: ProviderRecord[];
  blockedCandidates: Array<{ provider: ModelProvider; modelId: string; reason: string }>;
  score: RouteScore;
  createdAt: string;
}

interface ModelBrokerState {
  version: number;
  providers: ProviderRecord[];
  routeDecisions: RouteDecisionRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "model-broker-state.json");
const limiter = new InMemoryRateLimiter(120, 60_000);

const providerOrder: ModelProvider[] = ["openai", "anthropic", "google", "azure", "self_hosted"];
const capabilityOrder: Capability[] = ["json_schema", "tool_use", "vision", "streaming"];
const classOrder: DataClass[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PHI", "EPHI", "SECRET"];

const defaultProviders = (): ProviderRecord[] => [
  {
    provider: "self_hosted",
    modelId: "llama-3.1-70b-enterprise",
    enabled: true,
    supportsZeroRetention: true,
    capabilities: ["json_schema", "tool_use", "streaming"],
    contextWindow: 128_000,
    latencyMs: 1_900,
    costBand: "low",
    riskTier: "low"
  },
  {
    provider: "openai",
    modelId: "gpt-4.1",
    enabled: true,
    supportsZeroRetention: true,
    capabilities: ["json_schema", "tool_use", "vision", "streaming"],
    contextWindow: 128_000,
    latencyMs: 1_250,
    costBand: "medium",
    riskTier: "medium"
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    enabled: true,
    supportsZeroRetention: true,
    capabilities: ["json_schema", "tool_use", "vision", "streaming"],
    contextWindow: 200_000,
    latencyMs: 1_480,
    costBand: "medium",
    riskTier: "medium"
  },
  {
    provider: "azure",
    modelId: "azure-gpt-4.1",
    enabled: true,
    supportsZeroRetention: true,
    capabilities: ["json_schema", "tool_use", "vision", "streaming"],
    contextWindow: 128_000,
    latencyMs: 1_360,
    costBand: "high",
    riskTier: "low"
  },
  {
    provider: "google",
    modelId: "gemini-2.5-pro",
    enabled: true,
    supportsZeroRetention: false,
    capabilities: ["json_schema", "tool_use", "vision", "streaming"],
    contextWindow: 1_000_000,
    latencyMs: 1_420,
    costBand: "medium",
    riskTier: "high"
  }
];

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toProvider = (value: unknown): ModelProvider | undefined =>
  value === "openai" || value === "anthropic" || value === "google" || value === "azure" || value === "self_hosted"
    ? value
    : undefined;

const toCapability = (value: unknown): Capability | undefined =>
  value === "json_schema" || value === "tool_use" || value === "vision" || value === "streaming"
    ? value
    : undefined;

const toDataClass = (value: unknown): DataClass =>
  value === "INTERNAL" ||
  value === "CONFIDENTIAL" ||
  value === "PII" ||
  value === "PHI" ||
  value === "EPHI" ||
  value === "SECRET"
    ? value
    : "PUBLIC";

const toCostBand = (value: unknown): CostBand => (value === "low" || value === "high" ? value : "medium");

const costScore = (band: CostBand): number => {
  if (band === "low") return 1;
  if (band === "medium") return 0.7;
  return 0.45;
};

const riskScore = (tier: ProviderRecord["riskTier"]): number => {
  if (tier === "low") return 1;
  if (tier === "medium") return 0.7;
  return 0.35;
};

const normalizeState = (state: Partial<ModelBrokerState> | undefined): ModelBrokerState => {
  const providers = Array.isArray(state?.providers)
    ? state.providers.filter((provider): provider is ProviderRecord => {
        if (!provider || typeof provider !== "object") return false;
        const current = provider as ProviderRecord;
        return Boolean(toProvider(current.provider) && toString(current.modelId));
      })
    : [];
  return {
    version: 1,
    providers: providers.length > 0 ? providers : defaultProviders(),
    routeDecisions: Array.isArray(state?.routeDecisions) ? state.routeDecisions : []
  };
};

const loadState = async (): Promise<ModelBrokerState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<ModelBrokerState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: ModelBrokerState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const parseRouteInput = (body: JsonMap): RouteInput | undefined => {
  const sensitivity = toDataClass(body.sensitivity);
  const requiredCapabilities = Array.isArray(body.requiredCapabilities)
    ? body.requiredCapabilities
        .map(toCapability)
        .filter((capability): capability is Capability => capability !== undefined)
    : [];
  const maxLatencyRaw = typeof body.maxLatencyMs === "number" ? body.maxLatencyMs : 2_000;
  const maxLatencyMs = Math.max(500, Math.min(15_000, Math.floor(maxLatencyRaw)));
  const providerAllowList = Array.isArray(body.providerAllowList)
    ? body.providerAllowList
        .map(toProvider)
        .filter((provider): provider is ModelProvider => provider !== undefined)
    : undefined;

  if (requiredCapabilities.length > 8) return undefined;
  if (providerAllowList && providerAllowList.length === 0) return undefined;

  return {
    sensitivity,
    requiredCapabilities,
    zeroRetentionRequired: body.zeroRetentionRequired !== false,
    maxLatencyMs,
    costCeiling: toCostBand(body.costCeiling),
    ...(providerAllowList ? { providerAllowList } : {})
  };
};

const includesCapabilities = (provider: ProviderRecord, required: Capability[]): boolean =>
  required.every((capability) => provider.capabilities.includes(capability));

const withinCostCeiling = (provider: ProviderRecord, ceiling: CostBand): boolean => {
  if (ceiling === "high") return true;
  if (ceiling === "medium") return provider.costBand !== "high";
  return provider.costBand === "low";
};

const sensitivityRestricted = (sensitivity: DataClass, provider: ProviderRecord): string | undefined => {
  if (sensitivity === "SECRET" && provider.provider !== "self_hosted") {
    return "secret_requires_self_hosted";
  }
  if ((sensitivity === "PHI" || sensitivity === "EPHI") && provider.riskTier === "high") {
    return "sensitive_data_blocks_high_risk_provider";
  }
  return undefined;
};

const evaluateRoute = (input: RouteInput, providers: ProviderRecord[]) => {
  const allowedCandidates: Array<{ provider: ProviderRecord; score: RouteScore }> = [];
  const blockedCandidates: Array<{ provider: ModelProvider; modelId: string; reason: string }> = [];

  for (const provider of providers) {
    if (!provider.enabled) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: "provider_disabled" });
      continue;
    }

    if (input.providerAllowList && !input.providerAllowList.includes(provider.provider)) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: "not_in_allow_list" });
      continue;
    }

    if (input.zeroRetentionRequired && !provider.supportsZeroRetention) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: "zero_retention_required" });
      continue;
    }

    if (!includesCapabilities(provider, input.requiredCapabilities)) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: "required_capabilities_missing" });
      continue;
    }

    if (!withinCostCeiling(provider, input.costCeiling)) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: "cost_ceiling_exceeded" });
      continue;
    }

    const sensitivityRule = sensitivityRestricted(input.sensitivity, provider);
    if (sensitivityRule) {
      blockedCandidates.push({ provider: provider.provider, modelId: provider.modelId, reason: sensitivityRule });
      continue;
    }

    const latencyDelta = Math.max(0, provider.latencyMs - input.maxLatencyMs);
    const latencyScore = latencyDelta === 0 ? 1 : Math.max(0, 1 - latencyDelta / input.maxLatencyMs);
    const score: RouteScore = {
      cost: costScore(provider.costBand),
      latency: Number(latencyScore.toFixed(4)),
      risk: riskScore(provider.riskTier),
      total: Number((costScore(provider.costBand) * 0.25 + latencyScore * 0.25 + riskScore(provider.riskTier) * 0.5).toFixed(4))
    };

    allowedCandidates.push({ provider, score });
  }

  if (allowedCandidates.length === 0) {
    return { selected: undefined, fallback: [], blockedCandidates };
  }

  const ranked = allowedCandidates.sort((left, right) => {
    if (right.score.total !== left.score.total) return right.score.total - left.score.total;
    if (left.provider.latencyMs !== right.provider.latencyMs) return left.provider.latencyMs - right.provider.latencyMs;
    return providerOrder.indexOf(left.provider.provider) - providerOrder.indexOf(right.provider.provider);
  });

  const selected = ranked[0]!;
  const fallback = ranked.slice(1).map((candidate) => candidate.provider);
  return { selected, fallback, blockedCandidates };
};

const sanitizeProvider = (provider: ProviderRecord) => ({
  provider: provider.provider,
  modelId: provider.modelId,
  enabled: provider.enabled,
  supportsZeroRetention: provider.supportsZeroRetention,
  capabilities: capabilityOrder.filter((capability) => provider.capabilities.includes(capability)),
  contextWindow: provider.contextWindow,
  latencyMs: provider.latencyMs,
  costBand: provider.costBand,
  riskTier: provider.riskTier
});

const parseProviderPayload = (body: JsonMap): ProviderRecord | undefined => {
  const provider = toProvider(body.provider);
  const modelId = toString(body.modelId);
  if (!provider || !modelId || modelId.length > 120) return undefined;

  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities
        .map(toCapability)
        .filter((capability): capability is Capability => capability !== undefined)
    : [];
  if (capabilities.length === 0 || capabilities.length > 8) return undefined;

  const contextWindowRaw = typeof body.contextWindow === "number" ? body.contextWindow : 8_192;
  const contextWindow = Math.max(2_048, Math.min(2_000_000, Math.floor(contextWindowRaw)));
  const latencyRaw = typeof body.latencyMs === "number" ? body.latencyMs : 2_000;
  const latencyMs = Math.max(200, Math.min(30_000, Math.floor(latencyRaw)));

  const riskTier = body.riskTier === "low" || body.riskTier === "high" ? body.riskTier : "medium";

  return {
    provider,
    modelId,
    enabled: body.enabled !== false,
    supportsZeroRetention: body.supportsZeroRetention !== false,
    capabilities,
    contextWindow,
    latencyMs,
    costBand: toCostBand(body.costBand),
    riskTier
  };
};

const createDecisionId = (tenantId: string, actorId: string, input: RouteInput, sequence: number): string =>
  `route-${sha256Hex(stableSerialize({ tenantId, actorId, input, sequence })).slice(0, 18)}`;

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const endpoint = parsedUrl.pathname;
  const context = parseContext(request);

  const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${endpoint}`;
  if (!enforceRateLimit(response, context.requestId, limiter.check(rateKey))) return;

  if (method === "GET" && endpoint === "/healthz") {
    const state = await loadState();
    sendJson(
      response,
      200,
      { status: "ok", service: descriptor.serviceName, providers: state.providers.length, decisions: state.routeDecisions.length },
      context.requestId
    );
    return;
  }

  if (method === "GET" && endpoint === "/v1/model-broker/providers/capabilities") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "analyst", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const state = await loadState();
    sendJson(response, 200, { providers: state.providers.map(sanitizeProvider) }, context.requestId);
    return;
  }

  if (method === "POST" && endpoint === "/v1/model-broker/providers") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const body = await readJson(request, 64 * 1024);
    const provider = parseProviderPayload(body);
    if (!provider) {
      sendJson(response, 400, { error: "invalid_provider_payload" }, context.requestId);
      return;
    }

    const state = await loadState();
    const existingIndex = state.providers.findIndex(
      (current) => current.provider === provider.provider && current.modelId === provider.modelId
    );
    if (existingIndex >= 0) {
      state.providers[existingIndex] = provider;
    } else {
      state.providers.push(provider);
    }
    await saveState(state);
    sendJson(response, existingIndex >= 0 ? 200 : 201, { provider: sanitizeProvider(provider) }, context.requestId);
    return;
  }

  if (method === "POST" && endpoint === "/v1/model-broker/routes/evaluate") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const body = await readJson(request, 64 * 1024);
    const input = parseRouteInput(body);
    if (!input) {
      sendJson(response, 400, { error: "invalid_route_input" }, context.requestId);
      return;
    }

    const state = await loadState();
    const evaluated = evaluateRoute(input, state.providers);
    if (!evaluated.selected) {
      sendJson(
        response,
        422,
        { error: "no_allowed_provider_route", blockedCandidates: evaluated.blockedCandidates },
        context.requestId
      );
      return;
    }

    const decision: RouteDecisionRecord = {
      decisionId: createDecisionId(
        secured.tenantId ?? "unknown",
        secured.actorId ?? "unknown",
        input,
        state.routeDecisions.length + 1
      ),
      tenantId: secured.tenantId ?? "unknown",
      actorId: secured.actorId ?? "unknown",
      input,
      selected: evaluated.selected.provider,
      fallback: evaluated.fallback,
      blockedCandidates: evaluated.blockedCandidates,
      score: evaluated.selected.score,
      createdAt: nowIso()
    };

    state.routeDecisions.push(decision);
    await saveState(state);

    sendJson(
      response,
      200,
      {
        decisionId: decision.decisionId,
        selected: sanitizeProvider(decision.selected),
        fallback: decision.fallback.map(sanitizeProvider),
        blockedCandidates: decision.blockedCandidates,
        score: decision.score,
        policySummary: {
          sensitivity: decision.input.sensitivity,
          zeroRetentionRequired: decision.input.zeroRetentionRequired,
          requiredCapabilities: decision.input.requiredCapabilities
        }
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && endpoint === "/v1/model-broker/routes/decisions") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "auditor", "platform_admin"] },
      context
    );
    if (!secured) return;

    const state = await loadState();
    const limitRaw = Number(parsedUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

    const decisions = state.routeDecisions
      .filter((decision) => decision.tenantId === secured.tenantId)
      .slice()
      .reverse()
      .slice(0, limit)
      .map((decision) => ({
        ...decision,
        selected: sanitizeProvider(decision.selected),
        fallback: decision.fallback.map(sanitizeProvider)
      }));

    sendJson(response, 200, { decisions }, context.requestId);
    return;
  }

  sendJson(response, 404, { error: "not_found", service: descriptor.serviceName, endpoint }, context.requestId);
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
