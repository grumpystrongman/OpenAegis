import { createHash, createHmac, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface JsonMap {
  [key: string]: unknown;
}

export interface RequestContext {
  requestId: string;
  tenantId?: string | undefined;
  actorId?: string | undefined;
  roles: string[];
  mtlsClientSan?: string | undefined;
}

export interface SecurityRequirements {
  requireTenant?: boolean;
  requireActor?: boolean;
  requireMtls?: boolean;
  requiredRoles?: string[];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): RateLimitResult {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= nowMs) {
      const resetAt = nowMs + this.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        limit: this.maxPerWindow,
        remaining: this.maxPerWindow - 1,
        resetAt
      };
    }

    if (current.count >= this.maxPerWindow) {
      return {
        allowed: false,
        limit: this.maxPerWindow,
        remaining: 0,
        resetAt: current.resetAt
      };
    }

    current.count += 1;
    return {
      allowed: true,
      limit: this.maxPerWindow,
      remaining: this.maxPerWindow - current.count,
      resetAt: current.resetAt
    };
  }
}

export const sendJson = (response: ServerResponse, statusCode: number, body: unknown, requestId?: string) => {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    ...(requestId ? { "x-request-id": requestId } : {})
  });
  response.end(JSON.stringify(body));
};

export const readJson = async (request: IncomingMessage, maxBytes = 1024 * 1024): Promise<JsonMap> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("payload_too_large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonMap;
  } catch {
    return {};
  }
};

export const parseContext = (request: IncomingMessage): RequestContext => {
  const requestId =
    typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"].length > 0
      ? request.headers["x-request-id"]
      : randomUUID();
  const tenantId =
    typeof request.headers["x-tenant-id"] === "string" && request.headers["x-tenant-id"].trim().length > 0
      ? request.headers["x-tenant-id"].trim()
      : undefined;
  const actorId =
    typeof request.headers["x-actor-id"] === "string" && request.headers["x-actor-id"].trim().length > 0
      ? request.headers["x-actor-id"].trim()
      : undefined;
  const roles =
    typeof request.headers["x-roles"] === "string"
      ? request.headers["x-roles"].split(",").map((item) => item.trim()).filter((item) => item.length > 0)
      : [];
  const mtlsClientSan =
    typeof request.headers["x-mtls-client-san"] === "string" && request.headers["x-mtls-client-san"].trim().length > 0
      ? request.headers["x-mtls-client-san"].trim()
      : undefined;

  return { requestId, tenantId, actorId, roles, mtlsClientSan };
};

export const enforceSecurity = (
  request: IncomingMessage,
  response: ServerResponse,
  requirements: SecurityRequirements,
  context = parseContext(request)
): RequestContext | undefined => {
  const enforceMtls = requirements.requireMtls || process.env.OPENAEGIS_ENFORCE_MTLS === "true";

  if (requirements.requireTenant && !context.tenantId) {
    sendJson(response, 400, { error: "tenant_context_required" }, context.requestId);
    return undefined;
  }

  if (requirements.requireActor && !context.actorId) {
    sendJson(response, 401, { error: "actor_context_required" }, context.requestId);
    return undefined;
  }

  if (enforceMtls && !context.mtlsClientSan) {
    sendJson(response, 401, { error: "mtls_attestation_required" }, context.requestId);
    return undefined;
  }

  if (requirements.requiredRoles && requirements.requiredRoles.length > 0) {
    const hasRole = requirements.requiredRoles.some((role) => context.roles.includes(role));
    if (!hasRole) {
      sendJson(response, 403, { error: "insufficient_role" }, context.requestId);
      return undefined;
    }
  }

  return context;
};

export const enforceRateLimit = (
  response: ServerResponse,
  requestId: string,
  result: RateLimitResult
): boolean => {
  response.setHeader("x-ratelimit-limit", String(result.limit));
  response.setHeader("x-ratelimit-remaining", String(result.remaining));
  response.setHeader("x-ratelimit-reset", String(result.resetAt));
  if (!result.allowed) {
    sendJson(response, 429, { error: "rate_limit_exceeded" }, requestId);
    return false;
  }
  return true;
};

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
};

export const hmacSha256 = (key: string, payload: string): string =>
  createHmac("sha256", key).update(payload).digest("base64url");

export const nowIso = () => new Date().toISOString();
