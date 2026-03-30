import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import type { DataClass, DecisionEffect, PolicyDecision, PolicyInput, ServiceDescriptor } from "@openaegis/contracts";
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
  serviceName: "policy-service",
  listeningPort: Number(process.env.PORT ?? 3003),
  purpose: "OPA/Cedar policy evaluation and decision logs",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type RiskLevel = "low" | "medium" | "high" | "critical";
type RuntimeMode = "simulation" | "live";

interface PolicyRule {
  ruleId: string;
  description: string;
  actionPattern: string;
  dataClasses: DataClass[];
  effect: DecisionEffect;
  enabled: boolean;
  obligations: string[];
}

interface PolicyBundle {
  bundleId: string;
  version: number;
  name: string;
  rules: PolicyRule[];
  updatedAt: string;
  updatedBy: string;
}

interface DecisionRecord {
  decision: PolicyDecision;
  tenantId: string;
  actorId: string;
  input: PolicyInput;
  riskLevel: RiskLevel;
  mode: RuntimeMode;
  createdAt: string;
}

interface PolicyState {
  version: number;
  currentBundle: PolicyBundle;
  bundles: PolicyBundle[];
  decisions: DecisionRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "policy-service-state.json");
const limiter = new InMemoryRateLimiter(120, 60_000);

const defaultRules = (): PolicyRule[] => [
  {
    ruleId: "rule-secret-deny",
    description: "SECRET data must never leave trusted boundary.",
    actionPattern: "*",
    dataClasses: ["SECRET"],
    effect: "DENY",
    enabled: true,
    obligations: ["security_incident_if_attempted"]
  },
  {
    ruleId: "rule-phi-zero-retention",
    description: "PHI/EPHI external model calls require zero retention.",
    actionPattern: "model.infer",
    dataClasses: ["PHI", "EPHI"],
    effect: "DENY",
    enabled: true,
    obligations: ["zero_retention_required"]
  },
  {
    ruleId: "rule-high-risk-live-approval",
    description: "High-risk live actions require approval.",
    actionPattern: "workflow.execute",
    dataClasses: ["PII", "PHI", "EPHI", "CONFIDENTIAL", "SECRET"],
    effect: "REQUIRE_APPROVAL",
    enabled: true,
    obligations: ["human_approval"]
  }
];

const defaultBundle = (): PolicyBundle => ({
  bundleId: "bundle-default",
  version: 1,
  name: "Hospital Safe Baseline",
  rules: defaultRules(),
  updatedAt: nowIso(),
  updatedBy: "system"
});

const normalizeState = (state: Partial<PolicyState> | undefined): PolicyState => {
  const bundle = defaultBundle();
  return {
    version: 1,
    currentBundle:
      state?.currentBundle && Array.isArray(state.currentBundle.rules)
        ? state.currentBundle
        : bundle,
    bundles: Array.isArray(state?.bundles) && state.bundles.length > 0 ? state.bundles : [bundle],
    decisions: Array.isArray(state?.decisions) ? state.decisions : []
  };
};

const loadState = async (): Promise<PolicyState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<PolicyState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: PolicyState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toRisk = (value: unknown): RiskLevel =>
  value === "critical" || value === "high" || value === "medium" ? value : "low";

const toMode = (value: unknown): RuntimeMode => (value === "live" ? "live" : "simulation");

const toDataClassArray = (value: unknown): DataClass[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is DataClass =>
          item === "PUBLIC" ||
          item === "INTERNAL" ||
          item === "CONFIDENTIAL" ||
          item === "PII" ||
          item === "PHI" ||
          item === "EPHI" ||
          item === "SECRET"
      )
    : [];

const toRules = (value: unknown): PolicyRule[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rules: PolicyRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const ruleId = toString(record.ruleId);
    const description = toString(record.description);
    const actionPattern = toString(record.actionPattern);
    const dataClasses = toDataClassArray(record.dataClasses);
    const effect = record.effect === "DENY" || record.effect === "REQUIRE_APPROVAL" ? record.effect : "ALLOW";
    const enabled = record.enabled !== false;
    const obligations = Array.isArray(record.obligations)
      ? record.obligations.filter((obligation): obligation is string => typeof obligation === "string" && obligation.trim().length > 0)
      : [];
    if (!ruleId || !description || !actionPattern || dataClasses.length === 0) continue;
    rules.push({ ruleId, description, actionPattern, dataClasses, effect, enabled, obligations });
  }
  return rules.length > 0 ? rules : undefined;
};

const matchesPattern = (pattern: string, action: string): boolean => {
  if (pattern === "*") return true;
  if (pattern === action) return true;
  if (pattern.endsWith("*")) return action.startsWith(pattern.slice(0, -1));
  return false;
};

const evaluate = (bundle: PolicyBundle, input: PolicyInput, riskLevel: RiskLevel, mode: RuntimeMode): PolicyDecision => {
  const reasons: string[] = [];
  const obligations = ["audit_log"];
  const matchedPolicyIds: string[] = [];
  let effect: DecisionEffect = "ALLOW";

  for (const rule of bundle.rules) {
    if (!rule.enabled) continue;
    if (!matchesPattern(rule.actionPattern, input.action)) continue;
    if (!input.dataClasses.some((dataClass) => rule.dataClasses.includes(dataClass))) continue;
    matchedPolicyIds.push(rule.ruleId);
    reasons.push(rule.description);
    obligations.push(...rule.obligations);

    if (rule.effect === "DENY") {
      effect = "DENY";
      break;
    }
    if (rule.effect === "REQUIRE_APPROVAL") {
      effect = "REQUIRE_APPROVAL";
    }
  }

  if (effect !== "DENY" && mode === "live" && (riskLevel === "high" || riskLevel === "critical")) {
    effect = "REQUIRE_APPROVAL";
    obligations.push("human_approval");
    reasons.push("Live high-risk action requires approval.");
  }

  const decisionPayload = {
    input,
    riskLevel,
    mode,
    effect,
    matchedPolicyIds,
    obligations
  };

  return {
    decisionId: `dec-${sha256Hex(stableSerialize(decisionPayload)).slice(0, 16)}`,
    effect,
    obligations: Array.from(new Set(obligations)),
    reasons,
    matchedPolicyIds,
    ttlSeconds: 300
  };
};

const buildInput = (body: JsonMap): PolicyInput => {
  const input: PolicyInput = {
    action: toString(body.action) ?? "unknown",
    resource: toString(body.resource) ?? "unknown",
    dataClasses: toDataClassArray(body.dataClasses),
    purpose: toString(body.purpose) ?? "unspecified"
  };
  const destination = toString(body.destination);
  const toolId = toString(body.toolId);
  const modelId = toString(body.modelId);
  if (destination) input.destination = destination;
  if (toolId) input.toolId = toolId;
  if (modelId) input.modelId = modelId;
  return input;
};

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const path = parsedUrl.pathname;
  const context = parseContext(request);

  const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${path}`;
  if (!enforceRateLimit(response, context.requestId, limiter.check(rateKey))) return;

  if (method === "GET" && path === "/healthz") {
    const state = await loadState();
    sendJson(
      response,
      200,
      {
        status: "ok",
        service: descriptor.serviceName,
        bundleVersion: state.currentBundle.version,
        decisions: state.decisions.length
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && path === "/v1/policies/bundles/current") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const state = await loadState();
    sendJson(response, 200, { bundle: state.currentBundle }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/policies/bundles") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    sendJson(response, 200, { bundles: state.bundles.slice().sort((a, b) => b.version - a.version) }, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/policies/bundles") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const name = toString(body.name);
    const rules = toRules(body.rules);
    if (!name || !rules) {
      sendJson(response, 400, { error: "name_and_valid_rules_required" }, context.requestId);
      return;
    }
    const state = await loadState();
    const nextVersion = state.currentBundle.version + 1;
    const bundle: PolicyBundle = {
      bundleId: `bundle-${nextVersion}`,
      version: nextVersion,
      name,
      rules,
      updatedAt: nowIso(),
      updatedBy: secured.actorId ?? "unknown"
    };
    state.currentBundle = bundle;
    state.bundles.unshift(bundle);
    await saveState(state);
    sendJson(response, 201, { bundle }, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/policies/evaluate") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const state = await loadState();
    const input = buildInput(body);
    const riskLevel = toRisk(body.riskLevel);
    const mode = toMode(body.mode);
    const decision = evaluate(state.currentBundle, input, riskLevel, mode);
    state.decisions.push({
      decision,
      tenantId: secured.tenantId ?? "unknown",
      actorId: secured.actorId ?? "unknown",
      input,
      riskLevel,
      mode,
      createdAt: nowIso()
    });
    await saveState(state);
    sendJson(response, 200, { decision }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/policies/decisions") {
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
    sendJson(
      response,
      200,
      {
        decisions: state.decisions
          .filter((item) => item.tenantId === secured.tenantId)
          .slice()
          .reverse()
          .slice(0, limit)
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
