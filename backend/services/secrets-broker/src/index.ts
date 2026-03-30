import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL, pathToFileURL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import {
  InMemoryRateLimiter,
  enforceRateLimit,
  enforceSecurity,
  nowIso,
  parseContext,
  readJson,
  sendJson,
  sha256Hex
} from "@openaegis/security-kit";

export const descriptor: ServiceDescriptor = {
  serviceName: "secrets-broker",
  listeningPort: Number(process.env.PORT ?? 3014),
  purpose: "Short-lived credential leasing and rotation events",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type LeaseStatus = "active" | "revoked" | "expired";

interface SecretRecord {
  secretId: string;
  tenantId: string;
  kmsProvider: "local" | "aws" | "azure" | "gcp";
  keyVersion: string;
  cipherText: string;
  iv: string;
  authTag: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface LeaseRecord {
  leaseId: string;
  secretId: string;
  tenantId: string;
  purpose: string;
  issuedTo: string;
  issuedAt: string;
  expiresAt: string;
  status: LeaseStatus;
}

interface SecretsState {
  version: number;
  secrets: SecretRecord[];
  leases: LeaseRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "secrets-broker-state.json");
const limiter = new InMemoryRateLimiter(80, 60_000);
const supportedKmsProviders = new Set(["local", "aws", "azure", "gcp"]);
const defaultKmsProvider = "local";

const parseKmsProvider = (value: unknown): SecretRecord["kmsProvider"] | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!supportedKmsProviders.has(normalized)) return undefined;
  return normalized as SecretRecord["kmsProvider"];
};

const resolveKmsProvider = (value: unknown): SecretRecord["kmsProvider"] =>
  parseKmsProvider(value) ?? defaultKmsProvider;

const resolveKeyVersion = (provider: SecretRecord["kmsProvider"]): string => {
  const providerSpecific = process.env[`OPENAEGIS_${provider.toUpperCase()}_KMS_KEY_VERSION`];
  const shared = process.env.OPENAEGIS_KMS_KEY_VERSION;
  return toString(providerSpecific) ?? toString(shared) ?? "v1";
};

const deriveKek = (material: string): Buffer => createHash("sha256").update(material).digest();

const resolveKekMaterial = (provider: SecretRecord["kmsProvider"]): string | undefined => {
  switch (provider) {
    case "local":
      return process.env.OPENAEGIS_LOCAL_KEK ?? "dev-local-kek-change-me";
    case "aws":
      return process.env.OPENAEGIS_AWS_KMS_KEK ?? process.env.OPENAEGIS_KMS_KEK;
    case "azure":
      return process.env.OPENAEGIS_AZURE_KMS_KEK ?? process.env.OPENAEGIS_KMS_KEK;
    case "gcp":
      return process.env.OPENAEGIS_GCP_KMS_KEK ?? process.env.OPENAEGIS_KMS_KEK;
    default:
      return undefined;
  }
};

const resolveKek = (provider: SecretRecord["kmsProvider"]): Buffer => {
  const material = resolveKekMaterial(provider);
  if (!material || material.trim().length === 0) {
    throw new Error(`kms_kek_material_missing_for_provider_${provider}`);
  }
  return deriveKek(material.trim());
};

const normalizeState = (state: Partial<SecretsState> | undefined): SecretsState => ({
  version: 1,
  secrets: Array.isArray(state?.secrets) ? state.secrets : [],
  leases: Array.isArray(state?.leases) ? state.leases : []
});

const loadState = async (): Promise<SecretsState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<SecretsState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: SecretsState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const encryptLocal = (plainText: string, kek: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
};

const decryptLocal = (record: SecretRecord, kek: Buffer): string => {
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.cipherText, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};

const encryptValue = (plainText: string, provider: SecretRecord["kmsProvider"]) => {
  const kek = resolveKek(provider);
  return encryptLocal(plainText, kek);
};

const decryptValue = (record: SecretRecord): string => {
  const kek = resolveKek(record.kmsProvider);
  return decryptLocal(record, kek);
};

const resolveLeaseStatus = (lease: LeaseRecord): LeaseStatus => {
  if (lease.status === "revoked") return "revoked";
  return Date.now() > new Date(lease.expiresAt).getTime() ? "expired" : "active";
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
    const configuredProvider = resolveKmsProvider(process.env.OPENAEGIS_KMS_PROVIDER);
    sendJson(
      response,
      200,
      {
        status: "ok",
        service: descriptor.serviceName,
        secrets: state.secrets.length,
        leases: state.leases.length,
        kmsProvider: configuredProvider
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/secrets/register") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const secretId = toString(body.secretId);
    const value = toString(body.value);
    if (!secretId || !value) {
      sendJson(response, 400, { error: "secret_id_and_value_required" }, context.requestId);
      return;
    }

    const state = await loadState();
    if (state.secrets.some((item) => item.secretId === secretId && item.tenantId === secured.tenantId)) {
      sendJson(response, 409, { error: "secret_already_exists" }, context.requestId);
      return;
    }
    const configuredProvider = resolveKmsProvider(process.env.OPENAEGIS_KMS_PROVIDER);
    const requestProvider = parseKmsProvider(body.kmsProvider);
    if (body.kmsProvider && !requestProvider) {
      sendJson(response, 400, { error: "unsupported_kms_provider" }, context.requestId);
      return;
    }
    const targetProvider = requestProvider ?? configuredProvider;
    const encrypted = encryptValue(value, targetProvider);
    const record: SecretRecord = {
      secretId,
      tenantId: secured.tenantId ?? "unknown",
      kmsProvider: targetProvider,
      keyVersion: resolveKeyVersion(targetProvider),
      ...encrypted,
      createdBy: secured.actorId ?? "unknown",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.secrets.push(record);
    await saveState(state);
    sendJson(response, 201, { secretId: record.secretId, tenantId: record.tenantId, keyVersion: record.keyVersion }, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/secrets/rotate") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const secretId = toString(body.secretId);
    const value = toString(body.value);
    if (!secretId || !value) {
      sendJson(response, 400, { error: "secret_id_and_value_required" }, context.requestId);
      return;
    }
    const state = await loadState();
    const secret = state.secrets.find((item) => item.secretId === secretId && item.tenantId === secured.tenantId);
    if (!secret) {
      sendJson(response, 404, { error: "secret_not_found" }, context.requestId);
      return;
    }
    const rotateProvider = body.kmsProvider ? parseKmsProvider(body.kmsProvider) : secret.kmsProvider;
    if (body.kmsProvider && !rotateProvider) {
      sendJson(response, 400, { error: "unsupported_kms_provider" }, context.requestId);
      return;
    }
    const encrypted = encryptValue(value, rotateProvider ?? secret.kmsProvider);
    secret.cipherText = encrypted.cipherText;
    secret.iv = encrypted.iv;
    secret.authTag = encrypted.authTag;
    secret.kmsProvider = rotateProvider ?? secret.kmsProvider;
    secret.keyVersion = resolveKeyVersion(secret.kmsProvider);
    secret.updatedAt = nowIso();
    await saveState(state);
    sendJson(
      response,
      200,
      { secretId, rotatedAt: secret.updatedAt, kmsProvider: secret.kmsProvider, keyVersion: secret.keyVersion },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/secrets/lease") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const secretId = toString(body.secretId);
    const purpose = toString(body.purpose) ?? "unspecified";
    const ttlSecondsRaw = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 900;
    const ttlSeconds = Math.max(60, Math.min(3600, Math.floor(ttlSecondsRaw)));
    if (!secretId) {
      sendJson(response, 400, { error: "secret_id_required" }, context.requestId);
      return;
    }
    const state = await loadState();
    const secret = state.secrets.find((item) => item.secretId === secretId && item.tenantId === secured.tenantId);
    if (!secret) {
      sendJson(response, 404, { error: "secret_not_found" }, context.requestId);
      return;
    }
    const leaseId = `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const lease: LeaseRecord = {
      leaseId,
      secretId,
      tenantId: secured.tenantId ?? "unknown",
      purpose,
      issuedTo: secured.actorId ?? "unknown",
      issuedAt: nowIso(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      status: "active"
    };
    state.leases.push(lease);
    await saveState(state);
    sendJson(
      response,
      200,
      {
        leaseId,
        secretId,
        secretValue: decryptValue(secret),
        expiresAt: lease.expiresAt,
        purpose
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && path === "/v1/secrets/renew") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const leaseId = toString(body.leaseId);
    const ttlSecondsRaw = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 900;
    const ttlSeconds = Math.max(60, Math.min(3600, Math.floor(ttlSecondsRaw)));
    if (!leaseId) {
      sendJson(response, 400, { error: "lease_id_required" }, context.requestId);
      return;
    }
    const state = await loadState();
    const lease = state.leases.find((item) => item.leaseId === leaseId && item.tenantId === secured.tenantId);
    if (!lease) {
      sendJson(response, 404, { error: "lease_not_found" }, context.requestId);
      return;
    }
    if (resolveLeaseStatus(lease) !== "active") {
      sendJson(response, 409, { error: "lease_not_active" }, context.requestId);
      return;
    }
    lease.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await saveState(state);
    sendJson(response, 200, { leaseId: lease.leaseId, expiresAt: lease.expiresAt }, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/secrets/revoke") {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const body = await readJson(request);
    const leaseId = toString(body.leaseId);
    if (!leaseId) {
      sendJson(response, 400, { error: "lease_id_required" }, context.requestId);
      return;
    }
    const state = await loadState();
    const lease = state.leases.find((item) => item.leaseId === leaseId && item.tenantId === secured.tenantId);
    if (!lease) {
      sendJson(response, 404, { error: "lease_not_found" }, context.requestId);
      return;
    }
    lease.status = "revoked";
    await saveState(state);
    sendJson(response, 200, { leaseId: lease.leaseId, revoked: true }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/secrets/leases") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "auditor", "platform_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    sendJson(
      response,
      200,
      {
        leases: state.leases
          .filter((lease) => lease.tenantId === secured.tenantId)
          .map((lease) => ({ ...lease, status: resolveLeaseStatus(lease) }))
          .slice()
          .reverse()
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && path === "/v1/secrets/inventory") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["security_admin", "auditor", "platform_admin"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    sendJson(
      response,
      200,
      {
        secrets: state.secrets
          .filter((secret) => secret.tenantId === secured.tenantId)
          .map((secret) => ({
            secretId: secret.secretId,
            tenantId: secret.tenantId,
            kmsProvider: secret.kmsProvider,
            keyVersion: secret.keyVersion,
            fingerprint: sha256Hex(secret.cipherText).slice(0, 16),
            updatedAt: secret.updatedAt
          }))
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
      if (error instanceof Error && error.message.startsWith("kms_kek_material_missing_for_provider_")) {
        sendJson(response, 503, { error: "kms_provider_not_configured", detail: error.message }, requestId);
        return;
      }
      sendJson(response, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" }, requestId);
    });
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(`${descriptor.serviceName} listening on :${descriptor.listeningPort}`);
  });
}
