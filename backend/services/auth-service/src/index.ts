import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import {
  InMemoryRateLimiter,
  enforceRateLimit,
  enforceSecurity,
  hmacSha256,
  nowIso,
  parseContext,
  readJson,
  sendJson,
  type JsonMap
} from "@openaegis/security-kit";

export const descriptor: ServiceDescriptor = {
  serviceName: "auth-service",
  listeningPort: Number(process.env.PORT ?? 3001),
  purpose: "OIDC/SAML federation, token issuance, session assurance",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type Assurance = "aal1" | "aal2" | "aal3";

interface ServiceUser {
  subject: string;
  email: string;
  tenantId: string;
  roles: string[];
  assurance: Assurance;
}

interface SessionRecord {
  jti: string;
  subject: string;
  tenantId: string;
  roles: string[];
  assurance: Assurance;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

interface AuthState {
  version: number;
  users: ServiceUser[];
  sessions: SessionRecord[];
  activeKid: string;
}

const issuer = process.env.OPENAEGIS_AUTH_ISSUER ?? `http://127.0.0.1:${descriptor.listeningPort}`;
const signingKey = process.env.OPENAEGIS_AUTH_SIGNING_KEY ?? "dev-auth-signing-key-change-me";
const stateFile = resolve(process.cwd(), ".volumes", "auth-service-state.json");
const limiter = new InMemoryRateLimiter(80, 60_000);

const defaultUsers: ServiceUser[] = [
  {
    subject: "user-clinician",
    email: "clinician@starlighthealth.org",
    tenantId: "tenant-starlight-health",
    roles: ["workflow_operator", "analyst"],
    assurance: "aal2"
  },
  {
    subject: "user-security",
    email: "security@starlighthealth.org",
    tenantId: "tenant-starlight-health",
    roles: ["security_admin", "auditor", "approver", "platform_admin"],
    assurance: "aal3"
  },
  {
    subject: "service-gateway",
    email: "gateway@openaegis.local",
    tenantId: "tenant-platform",
    roles: ["service_account", "token_introspect"],
    assurance: "aal3"
  }
];

const normalizeState = (state: Partial<AuthState> | undefined): AuthState => ({
  version: 1,
  users: Array.isArray(state?.users) ? state.users : defaultUsers,
  sessions: Array.isArray(state?.sessions) ? state.sessions : [],
  activeKid: typeof state?.activeKid === "string" ? state.activeKid : "kid-main"
});

const loadState = async (): Promise<AuthState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<AuthState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: AuthState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

const encodeToken = (payload: JsonMap, kid: string): string => {
  const header = { alg: "HS256", typ: "JWT", kid };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = hmacSha256(signingKey, signingInput);
  return `${signingInput}.${signature}`;
};

const decodeTokenPayload = (token: string): JsonMap | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return undefined;
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = hmacSha256(signingKey, signingInput);
  if (expected !== signaturePart) return undefined;
  try {
    return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as JsonMap;
  } catch {
    return undefined;
  }
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toRoles = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;

const toAssurance = (value: unknown): Assurance | undefined =>
  value === "aal1" || value === "aal2" || value === "aal3" ? value : undefined;

const mintToken = (input: {
  subject: string;
  tenantId: string;
  roles: string[];
  assurance: Assurance;
  ttlSeconds: number;
  kid: string;
}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + input.ttlSeconds;
  const jti = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    iss: issuer,
    sub: input.subject,
    aud: "openaegis-control-plane",
    iat: nowSeconds,
    exp,
    jti,
    tenant_id: input.tenantId,
    roles: input.roles,
    aal: input.assurance
  };
  return {
    token: encodeToken(payload as JsonMap, input.kid),
    jti,
    expiresAt: new Date(exp * 1000).toISOString()
  };
};

const handleTokenIssue = async (body: JsonMap, response: ServerResponse, requestId: string) => {
  const email = toString(body.email);
  const subject = toString(body.subject);
  const tenantId = toString(body.tenantId);
  const roles = toRoles(body.roles);
  const assurance = toAssurance(body.assuranceLevel);
  const ttlSecondsRaw = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600;
  const ttlSeconds = Math.max(60, Math.min(8 * 60 * 60, Math.floor(ttlSecondsRaw)));

  const state = await loadState();
  const user = email ? state.users.find((item) => item.email.toLowerCase() === email.toLowerCase()) : undefined;
  const resolvedSubject = user?.subject ?? subject;
  const resolvedTenant = user?.tenantId ?? tenantId;
  const resolvedRoles = user?.roles ?? roles;
  const resolvedAssurance = user?.assurance ?? assurance ?? "aal2";

  if (!resolvedSubject || !resolvedTenant || !resolvedRoles || resolvedRoles.length === 0) {
    sendJson(response, 400, { error: "insufficient_identity_context" }, requestId);
    return;
  }

  const minted = mintToken({
    subject: resolvedSubject,
    tenantId: resolvedTenant,
    roles: resolvedRoles,
    assurance: resolvedAssurance,
    ttlSeconds,
    kid: state.activeKid
  });

  state.sessions.push({
    jti: minted.jti,
    subject: resolvedSubject,
    tenantId: resolvedTenant,
    roles: resolvedRoles,
    assurance: resolvedAssurance,
    issuedAt: nowIso(),
    expiresAt: minted.expiresAt,
    revoked: false
  });
  await saveState(state);

  sendJson(
    response,
    200,
    {
      accessToken: minted.token,
      tokenType: "Bearer",
      expiresAt: minted.expiresAt,
      subject: resolvedSubject,
      tenantId: resolvedTenant,
      roles: resolvedRoles,
      assuranceLevel: resolvedAssurance
    },
    requestId
  );
};

const handleIntrospect = async (body: JsonMap, response: ServerResponse, requestId: string) => {
  const token = toString(body.token);
  if (!token) {
    sendJson(response, 400, { error: "token_required" }, requestId);
    return;
  }
  const payload = decodeTokenPayload(token);
  if (!payload) {
    sendJson(response, 200, { active: false }, requestId);
    return;
  }
  const jti = toString(payload.jti);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const state = await loadState();
  const session = jti ? state.sessions.find((item) => item.jti === jti) : undefined;
  const active = Boolean(session) && !session?.revoked && Date.now() < exp * 1000;

  sendJson(
    response,
    200,
    {
      active,
      ...(active
        ? {
            sub: payload.sub,
            tenantId: payload.tenant_id,
            roles: payload.roles,
            assuranceLevel: payload.aal,
            exp
          }
        : {})
    },
    requestId
  );
};

const handleRevoke = async (body: JsonMap, response: ServerResponse, requestId: string) => {
  const token = toString(body.token);
  if (!token) {
    sendJson(response, 400, { error: "token_required" }, requestId);
    return;
  }
  const payload = decodeTokenPayload(token);
  const jti = payload ? toString(payload.jti) : undefined;
  if (!jti) {
    sendJson(response, 200, { revoked: false }, requestId);
    return;
  }
  const state = await loadState();
  const session = state.sessions.find((item) => item.jti === jti);
  if (!session) {
    sendJson(response, 200, { revoked: false }, requestId);
    return;
  }
  session.revoked = true;
  await saveState(state);
  sendJson(response, 200, { revoked: true }, requestId);
};

const handleSessions = async (response: ServerResponse, requestId: string, tenantId?: string) => {
  const state = await loadState();
  sendJson(
    response,
    200,
    {
      sessions: state.sessions
        .filter((item) => (tenantId ? item.tenantId === tenantId : true))
        .slice()
        .reverse()
        .slice(0, 200)
    },
    requestId
  );
};

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", issuer);
  const path = parsedUrl.pathname;
  const context = parseContext(request);
  const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${path}`;
  if (!enforceRateLimit(response, context.requestId, limiter.check(rateKey))) return;

  if (method === "GET" && path === "/healthz") {
    const state = await loadState();
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, sessions: state.sessions.length }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/.well-known/openid-configuration") {
    sendJson(
      response,
      200,
      {
        issuer,
        token_endpoint: `${issuer}/v1/auth/token`,
        introspection_endpoint: `${issuer}/v1/auth/introspect`,
        revocation_endpoint: `${issuer}/v1/auth/revoke`,
        jwks_uri: `${issuer}/.well-known/jwks.json`
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && path === "/.well-known/jwks.json") {
    const state = await loadState();
    sendJson(
      response,
      200,
      {
        keys: [
          {
            kty: "oct",
            use: "sig",
            alg: "HS256",
            kid: state.activeKid
          }
        ]
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/auth/token") {
    const body = await readJson(request);
    await handleTokenIssue(body, response, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/auth/introspect") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    await handleIntrospect(body, response, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/auth/revoke") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    await handleRevoke(body, response, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/auth/sessions") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    await handleSessions(response, context.requestId, secured.tenantId);
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
