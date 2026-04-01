import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { ServiceDescriptor } from "@openaegis/contracts";
import { enforceSecurity, parseContext, readJson, sendJson } from "@openaegis/security-kit";
import {
  defaultRegistryState,
  type ConnectorTrustTier,
  type PluginAuthMethod,
  type PluginInstanceAuthInput,
  type PluginInstanceAuthRefs,
  type PluginInstanceConfig,
  type PluginInstanceRecord,
  type PluginInstanceStatus,
  type ToolAction,
  type ToolManifestRecord,
  type ToolManifestStatus,
  type ToolRegistryState
} from "./manifests.js";

export const descriptor: ServiceDescriptor = {
  serviceName: "tool-registry",
  listeningPort: 3006,
  purpose: "Signed connector/tool manifest registry",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

const STATE_FILE = resolve(process.cwd(), ".volumes", "tool-registry-state.json");
const now = () => new Date().toISOString();

type JsonMap = Record<string, unknown>;
type PluginInstanceListFilter = {
  manifestToolId?: string;
  status?: PluginInstanceStatus;
  authMethod?: PluginAuthMethod;
};

const supportedConnectorTypes = new Set<ToolManifestRecord["connectorType"]>([
  "microsoft-fabric",
  "power-bi",
  "sql",
  "fhir",
  "hl7",
  "sharepoint",
  "email",
  "ticketing",
  "project",
  "aws",
  "databricks",
  "fabric",
  "jira",
  "confluence",
  "openai",
  "anthropic",
  "google",
  "azure-openai",
  "airbyte",
  "airflow",
  "trino",
  "superset",
  "metabase",
  "grafana",
  "kafka",
  "nifi",
  "dagster",
  "n8n"
]);

const supportedAuthMethods = new Set<PluginAuthMethod>(["oauth2", "api_key", "service_principal", "key_pair"]);
const secretRefFields = new Set<keyof PluginInstanceAuthRefs>([
  "apiKeyRef",
  "clientSecretRef",
  "privateKeyRef",
  "certificateRef",
  "privateKeyPasswordRef",
  "refreshTokenRef",
  "accessTokenRef"
]);
const brokerRefFields = new Set<keyof PluginInstanceAuthRefs>([
  "brokerRef",
  "authorizationBrokerRef",
  "tokenBrokerRef",
  "refreshTokenBrokerRef",
  "callbackBrokerRef",
  "codeBrokerRef"
]);
const instanceConfigKeys = new Set<keyof PluginInstanceConfig>([
  "baseUrl",
  "endpoint",
  "region",
  "workspaceId",
  "projectKey",
  "model",
  "organizationId",
  "apiVersion"
]);
const manifestManageRoles = ["security_admin", "platform_admin"];
const publishRoles = ["security_admin", "platform_admin"];
const pluginInstanceManageRoles = ["security_admin", "platform_admin"];
const pluginInstanceViewRoles = ["security_admin", "platform_admin", "auditor"];

const normalizeState = (state: Partial<ToolRegistryState> | undefined): ToolRegistryState => {
  const base = defaultRegistryState();
  return {
    version: 2,
    manifests: Array.isArray(state?.manifests) ? state.manifests : base.manifests,
    instances: Array.isArray(state?.instances) ? state.instances : base.instances
  };
};

const loadState = async (): Promise<ToolRegistryState> => {
  try {
    return normalizeState(JSON.parse(await readFile(STATE_FILE, "utf8")) as Partial<ToolRegistryState>);
  } catch {
    return defaultRegistryState();
  }
};

const saveState = async (state: ToolRegistryState): Promise<void> => {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;

const toActionArray = (value: unknown): ToolAction[] | undefined => {
  const values = toStringArray(value);
  if (!values) return undefined;
  const allowed: ToolAction[] = [];
  for (const item of values) {
    if (item === "READ" || item === "WRITE" || item === "EXECUTE") allowed.push(item);
  }
  return allowed.length > 0 ? Array.from(new Set(allowed)) : undefined;
};

const toAuthMethod = (value: unknown): PluginAuthMethod | undefined => {
  if (value === "oauth2" || value === "api_key" || value === "service_principal" || value === "key_pair") return value;
  return undefined;
};

const toAuthMethodArray = (value: unknown): PluginAuthMethod[] | undefined => {
  const values = toStringArray(value);
  if (!values) return undefined;
  const allowed: PluginAuthMethod[] = [];
  for (const item of values) {
    const method = toAuthMethod(item);
    if (method) allowed.push(method);
  }
  return allowed.length > 0 ? Array.from(new Set(allowed)) : undefined;
};

const toTrustTier = (value: unknown): ConnectorTrustTier | undefined => {
  if (value === "tier-1" || value === "tier-2" || value === "tier-3" || value === "tier-4") return value;
  return undefined;
};

const toStatus = (value: unknown): ToolManifestStatus | undefined => {
  if (value === "draft" || value === "published") return value;
  return undefined;
};

const toInstanceStatus = (value: unknown): PluginInstanceStatus | undefined => {
  if (
    value === "pending_authorization" ||
    value === "ready" ||
    value === "authorized" ||
    value === "healthy" ||
    value === "unhealthy"
  ) {
    return value;
  }
  return undefined;
};

const isPlainObject = (value: unknown): value is JsonMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: unknown, allowedKeys: string[]): JsonMap | undefined => {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) return undefined;
  return value;
};

const validatePrefixedRef = (value: unknown, prefix: string): string | undefined => {
  const ref = toString(value);
  if (!ref || !ref.startsWith(prefix)) return undefined;
  return ref;
};

const ensureNoBrokerRefs = (refs: PluginInstanceAuthRefs | undefined): boolean => {
  if (!refs) return true;
  return Object.keys(refs).every((key) => !brokerRefFields.has(key as keyof PluginInstanceAuthRefs));
};

const validateSecretRefs = (refs: JsonMap | undefined): { refs?: PluginInstanceAuthRefs; error?: string } => {
  if (!refs) return { refs: {} };
  const parsed: PluginInstanceAuthRefs = {};
  for (const [key, rawValue] of Object.entries(refs)) {
    const field = key as keyof PluginInstanceAuthRefs;
    if (!secretRefFields.has(field)) {
      return { error: "unsupported_secret_reference_field" };
    }
    const ref = validatePrefixedRef(rawValue, "vault://");
    if (!ref) {
      return { error: `secret_reference_must_use_vault_prefix:${key}` };
    }
    parsed[field] = ref;
  }
  return { refs: parsed };
};

const validateBrokerRefs = (refs: JsonMap | undefined): { refs?: PluginInstanceAuthRefs; error?: string } => {
  if (!refs) return { refs: {} };
  const parsed: PluginInstanceAuthRefs = {};
  for (const [key, rawValue] of Object.entries(refs)) {
    const field = key as keyof PluginInstanceAuthRefs;
    if (!brokerRefFields.has(field)) {
      return { error: "unsupported_broker_reference_field" };
    }
    const ref = validatePrefixedRef(rawValue, "broker://");
    if (!ref) {
      return { error: `broker_reference_must_use_broker_prefix:${key}` };
    }
    parsed[field] = ref;
  }
  return { refs: parsed };
};

const defaultAuthMethodsForConnectorType = (connectorType: ToolManifestRecord["connectorType"]): PluginAuthMethod[] => {
  switch (connectorType) {
    case "openai":
    case "anthropic":
      return ["api_key"];
    case "azure-openai":
      return ["api_key", "service_principal"];
    case "airbyte":
    case "dagster":
    case "grafana":
    case "metabase":
    case "n8n":
    case "superset":
      return ["api_key", "oauth2"];
    case "airflow":
      return ["api_key", "oauth2"];
    case "aws":
    case "sql":
    case "fhir":
    case "hl7":
      return ["service_principal", "key_pair"];
    case "kafka":
    case "nifi":
    case "trino":
      return ["key_pair", "service_principal"];
    case "databricks":
    case "sharepoint":
    case "ticketing":
    case "project":
    case "jira":
    case "confluence":
    case "microsoft-fabric":
    case "fabric":
      return ["oauth2", "api_key"];
    case "power-bi":
      return ["oauth2", "api_key"];
    case "email":
      return ["service_principal", "key_pair"];
    default:
      return ["api_key"];
  }
};

const parseInstanceConfig = (value: unknown): { config?: PluginInstanceConfig; error?: string } => {
  if (value === undefined) return {};
  if (!isPlainObject(value)) return { error: "invalid_instance_config" };
  if (Object.keys(value).some((key) => !instanceConfigKeys.has(key as keyof PluginInstanceConfig))) {
    return { error: "unsupported_instance_config_field" };
  }

  const config: PluginInstanceConfig = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const resolved = toString(rawValue);
    if (!resolved) return { error: `instance_config_field_must_be_string:${key}` };
    config[key as keyof PluginInstanceConfig] = resolved;
  }
  return { config };
};

const resolveManifestAuth = (manifest: ToolManifestRecord): PluginAuthMethod[] =>
  manifest.authMethods.length > 0 ? Array.from(new Set(manifest.authMethods)) : defaultAuthMethodsForConnectorType(manifest.connectorType);

const buildManifestFromRequest = (body: JsonMap, actorId: string): { manifest?: ToolManifestRecord; error?: string } => {
  const toolId = toString(body.toolId);
  const displayName = toString(body.displayName);
  const connectorType = toString(body.connectorType) as ToolManifestRecord["connectorType"] | undefined;
  const description = toString(body.description);
  const version = toString(body.version) ?? "1.0.0";
  const trustTier = toTrustTier(body.trustTier);
  const allowedActions = toActionArray(body.allowedActions);
  const authMethods = toAuthMethodArray(body.authMethods);
  const permissionScopes = toStringArray(body.permissionScopes);
  const outboundDomains = toStringArray(body.outboundDomains);
  const signature = toString(body.signature);
  const signedBy = toString(body.signedBy) ?? actorId;
  const status = toStatus(body.status) ?? "draft";
  const rateLimitPerMinute = typeof body.rateLimitPerMinute === "number" ? body.rateLimitPerMinute : 60;
  const idempotent = body.idempotent !== false;
  const mockModeSupported = body.mockModeSupported !== false;

  if (
    !toolId ||
    !displayName ||
    !description ||
    !signature ||
    !trustTier ||
    !allowedActions ||
    !permissionScopes ||
    !outboundDomains ||
    !connectorType
  ) {
    return { error: "invalid_manifest_payload" };
  }

  if (!supportedConnectorTypes.has(connectorType)) {
    return { error: "unsupported_connector_type" };
  }

  const resolvedAuthMethods = authMethods ?? defaultAuthMethodsForConnectorType(connectorType);
  if (resolvedAuthMethods.some((method) => !supportedAuthMethods.has(method))) {
    return { error: "unsupported_auth_method" };
  }

  const timestamp = now();
  return {
    manifest: {
      toolId,
      displayName,
      connectorType,
      description,
      version,
      trustTier,
      allowedActions,
      authMethods: resolvedAuthMethods,
      permissionScopes,
      outboundDomains,
      rateLimitPerMinute,
      idempotent,
      mockModeSupported,
      signature,
      signedBy,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(status === "published" ? { publishedAt: timestamp } : {})
    }
  };
};

const listManifests = (manifests: ToolManifestRecord[], query: URL): ToolManifestRecord[] => {
  const status = toStatus(query.searchParams.get("status"));
  const capability = toString(query.searchParams.get("capability"));
  const trustTier = toTrustTier(query.searchParams.get("trustTier"));
  const authMethod = toAuthMethod(query.searchParams.get("authMethod"));

  return manifests.filter((manifest) => {
    if (status && manifest.status !== status) return false;
    if (trustTier && manifest.trustTier !== trustTier) return false;
    if (capability && !manifest.permissionScopes.some((scope) => scope.includes(capability))) return false;
    if (authMethod && !resolveManifestAuth(manifest).includes(authMethod)) return false;
    return true;
  });
};

const findManifest = (state: ToolRegistryState, toolId: string) => state.manifests.find((item) => item.toolId === toolId);

const validateInstanceAuth = (
  manifest: ToolManifestRecord,
  body: JsonMap
): { auth?: PluginInstanceAuthInput; brokerRefs?: PluginInstanceRecord["brokerRefs"]; error?: string } => {
  const authPayload = exactKeys(body.auth, ["method", "clientId", "tenantId", "principalId", "refs"]);
  if (!authPayload) return { error: "invalid_instance_auth" };

  const method = toAuthMethod(authPayload.method);
  const clientId = toString(authPayload.clientId);
  const tenantId = toString(authPayload.tenantId);
  const principalId = toString(authPayload.principalId);
  const refsPayload = authPayload.refs;
  const refs = isPlainObject(refsPayload) ? refsPayload : undefined;

  if (!method) return { error: "unsupported_instance_auth_method" };
  if (!resolveManifestAuth(manifest).includes(method)) return { error: "instance_auth_method_not_supported_by_manifest" };

  const validatedRefs = validateSecretRefs(refs);
  if (validatedRefs.error) return { error: validatedRefs.error };

  const parsedAuth: PluginInstanceAuthInput = {
    method,
    ...(clientId ? { clientId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(principalId ? { principalId } : {}),
    ...(validatedRefs.refs && Object.keys(validatedRefs.refs).length > 0 ? { refs: validatedRefs.refs } : {})
  };

  switch (method) {
    case "api_key":
      if (!parsedAuth.refs?.apiKeyRef) return { error: "api_key_reference_required" };
      break;
    case "service_principal":
      if (
        !parsedAuth.refs?.clientSecretRef &&
        !parsedAuth.refs?.privateKeyRef &&
        !parsedAuth.refs?.certificateRef
      ) {
        return { error: "service_principal_reference_required" };
      }
      break;
    case "key_pair":
      if (!parsedAuth.refs?.privateKeyRef) return { error: "private_key_reference_required" };
      break;
    case "oauth2":
      break;
    default:
      return { error: "unsupported_instance_auth_method" };
  }

  if (!ensureNoBrokerRefs(parsedAuth.refs)) {
    return { error: "broker_references_not_allowed_during_create" };
  }

  return { auth: parsedAuth };
};

const createInstanceFromRequest = (
  state: ToolRegistryState,
  body: JsonMap,
  tenantId: string,
  actorId: string
): { instance?: PluginInstanceRecord; error?: string } => {
  const allowedTopLevelKeys = ["manifestToolId", "displayName", "auth", "config"];
  if (!isPlainObject(body) || Object.keys(body).some((key) => !allowedTopLevelKeys.includes(key))) {
    return { error: "invalid_instance_payload" };
  }

  const manifestToolId = toString(body.manifestToolId);
  const displayName = toString(body.displayName);
  const manifest = manifestToolId ? findManifest(state, manifestToolId) : undefined;
  const authValidation = manifest ? validateInstanceAuth(manifest, body) : { error: "manifest_not_found" };
  const configValidation = parseInstanceConfig(body.config);

  if (!manifestToolId || !displayName || !manifest) return { error: "manifest_not_found" };
  if (!authValidation.auth) return { error: authValidation.error ?? "invalid_instance_auth" };
  if (configValidation.error) return { error: configValidation.error };

  const timestamp = now();
  const instanceId = `plugin-inst-${randomUUID()}`;
  return {
    instance: {
      instanceId,
      tenantId,
      createdBy: actorId,
      manifestToolId,
      displayName,
      status: authValidation.auth.method === "oauth2" ? "pending_authorization" : "ready",
      auth: authValidation.auth,
      ...(configValidation.config ? { config: configValidation.config } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
};

const listInstances = (instances: PluginInstanceRecord[], filter: PluginInstanceListFilter): PluginInstanceRecord[] =>
  instances.filter((instance) => {
    if (filter.manifestToolId && instance.manifestToolId !== filter.manifestToolId) return false;
    if (filter.status && instance.status !== filter.status) return false;
    if (filter.authMethod && instance.auth.method !== filter.authMethod) return false;
    return true;
  });

const getInstance = (state: ToolRegistryState, instanceId: string) => state.instances.find((item) => item.instanceId === instanceId);

const canAccessInstance = (
  roles: string[],
  tenantId: string | undefined,
  instance: PluginInstanceRecord
): boolean => roles.includes("platform_admin") || Boolean(tenantId) && tenantId === instance.tenantId;

const updateInstance = (
  instance: PluginInstanceRecord,
  patch: Partial<PluginInstanceRecord>
): PluginInstanceRecord => ({
  ...instance,
  ...patch,
  updatedAt: now()
});

const authorizeInstance = (
  instance: PluginInstanceRecord,
  body: JsonMap
): { instance?: PluginInstanceRecord; error?: string } => {
  const allowedTopLevelKeys = ["authorizationBrokerRef", "tokenBrokerRef", "refreshTokenBrokerRef", "callbackBrokerRef", "codeBrokerRef", "brokerRef"];
  if (!isPlainObject(body) || Object.keys(body).some((key) => !allowedTopLevelKeys.includes(key))) {
    return { error: "invalid_authorize_payload" };
  }

  const brokerValidation = validateBrokerRefs(body);
  if (brokerValidation.error) return { error: brokerValidation.error };
  if (!brokerValidation.refs || Object.keys(brokerValidation.refs).length === 0) {
    return { error: "broker_reference_required" };
  }

  const brokerRefs = {
    ...(instance.brokerRefs ?? {}),
    ...(brokerValidation.refs.authorizationBrokerRef ? { authorizationBrokerRef: brokerValidation.refs.authorizationBrokerRef } : {}),
    ...(brokerValidation.refs.tokenBrokerRef ? { tokenBrokerRef: brokerValidation.refs.tokenBrokerRef } : {}),
    ...(brokerValidation.refs.refreshTokenBrokerRef ? { refreshTokenBrokerRef: brokerValidation.refs.refreshTokenBrokerRef } : {}),
    ...(brokerValidation.refs.callbackBrokerRef ? { callbackBrokerRef: brokerValidation.refs.callbackBrokerRef } : {}),
    ...(brokerValidation.refs.codeBrokerRef ? { codeBrokerRef: brokerValidation.refs.codeBrokerRef } : {}),
    ...(brokerValidation.refs.brokerRef ? { authorizationBrokerRef: brokerValidation.refs.brokerRef } : {})
  };

  return {
    instance: updateInstance(instance, {
      status: "authorized",
      brokerRefs,
      lastAuthorizedAt: now()
    })
  };
};

const authIsReadyForTest = (instance: PluginInstanceRecord): boolean => {
  const refs = instance.auth.refs ?? {};
  switch (instance.auth.method) {
    case "api_key":
      return Boolean(refs.apiKeyRef);
    case "service_principal":
      return Boolean(refs.clientSecretRef || refs.privateKeyRef || refs.certificateRef);
    case "key_pair":
      return Boolean(refs.privateKeyRef);
    case "oauth2":
      return Boolean(instance.brokerRefs?.tokenBrokerRef || instance.brokerRefs?.authorizationBrokerRef);
    default:
      return false;
  }
};

const testInstance = (instance: PluginInstanceRecord): { instance?: PluginInstanceRecord; error?: string } => {
  if (!authIsReadyForTest(instance)) {
    return { error: "instance_auth_not_ready" };
  }

  const tested = updateInstance(instance, {
    status: "healthy",
    lastTestAt: now(),
    lastTestStatus: "passed",
    lastTestMessage: `Validated ${instance.manifestToolId} using ${instance.auth.method}`
  });

  return { instance: tested };
};

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const pathname = parsedUrl.pathname;
  const context = parseContext(request);

  if (method === "GET" && pathname === "/healthz") {
    const state = await loadState();
    sendJson(response, 200, {
      status: "ok",
      service: descriptor.serviceName,
      manifests: state.manifests.length,
      instances: state.instances.length
    }, context.requestId);
    return;
  }

  if (method === "GET" && pathname === "/v1/tools") {
    const state = await loadState();
    sendJson(response, 200, { manifests: listManifests(state.manifests, parsedUrl) }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/tools\/[^/]+$/.test(pathname)) {
    const toolId = pathname.split("/")[3] ?? "";
    const state = await loadState();
    const manifest = state.manifests.find((item) => item.toolId === toolId);
    if (!manifest) {
      sendJson(response, 404, { error: "tool_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, manifest, context.requestId);
    return;
  }

  if (method === "POST" && pathname === "/v1/tools") {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: manifestManageRoles
    }, context);
    if (!secured) return;
    const actorId = secured.actorId ?? "unknown";

    const body = await readJson(request);
    const built = buildManifestFromRequest(body, actorId);
    if (!built.manifest) {
      sendJson(response, 400, { error: built.error ?? "invalid_manifest_payload" }, context.requestId);
      return;
    }

    const state = await loadState();
    if (state.manifests.some((item) => item.toolId === built.manifest!.toolId)) {
      sendJson(response, 409, { error: "tool_manifest_already_exists" }, context.requestId);
      return;
    }

    state.manifests.push(built.manifest);
    await saveState(state);
    sendJson(response, 201, built.manifest, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/tools\/[^/]+\/publish$/.test(pathname)) {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: publishRoles
    }, context);
    if (!secured) return;
    const actorId = secured.actorId ?? "unknown";
    const toolId = pathname.split("/")[3] ?? "";
    const body = await readJson(request);
    const signer = toString(body.signer) ?? actorId;

    const state = await loadState();
    const index = state.manifests.findIndex((item) => item.toolId === toolId);
    if (index === -1) {
      sendJson(response, 404, { error: "tool_not_found" }, context.requestId);
      return;
    }

    const manifest = state.manifests[index]!;
    state.manifests[index] = {
      ...manifest,
      status: "published",
      signedBy: signer,
      updatedAt: now(),
      publishedAt: now()
    };
    await saveState(state);
    sendJson(response, 200, state.manifests[index], context.requestId);
    return;
  }

  if (method === "GET" && pathname === "/v1/plugins/instances") {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: pluginInstanceViewRoles
    }, context);
    if (!secured) return;
    const state = await loadState();
    const filter: PluginInstanceListFilter = {};
    const manifestToolId = toString(parsedUrl.searchParams.get("manifestToolId"));
    const status = toInstanceStatus(parsedUrl.searchParams.get("status"));
    const authMethod = toAuthMethod(parsedUrl.searchParams.get("authMethod"));
    if (manifestToolId) filter.manifestToolId = manifestToolId;
    if (status) filter.status = status;
    if (authMethod) filter.authMethod = authMethod;
    const visibleInstances = secured.roles.includes("platform_admin")
      ? state.instances
      : state.instances.filter((instance) => instance.tenantId === secured.tenantId);
    sendJson(response, 200, { instances: listInstances(visibleInstances, filter) }, context.requestId);
    return;
  }

  if (method === "POST" && pathname === "/v1/plugins/instances") {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: pluginInstanceManageRoles
    }, context);
    if (!secured) return;
    const body = await readJson(request);
    const state = await loadState();
    const built = createInstanceFromRequest(state, body, secured.tenantId ?? "unknown", secured.actorId ?? "unknown");
    if (!built.instance) {
      sendJson(response, 400, { error: built.error ?? "invalid_instance_payload" }, context.requestId);
      return;
    }

    state.instances.push(built.instance);
    await saveState(state);
    sendJson(response, 201, built.instance, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/plugins\/instances\/[^/]+\/authorize$/.test(pathname)) {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: pluginInstanceManageRoles
    }, context);
    if (!secured) return;
    const instanceId = pathname.split("/")[4] ?? "";
    const body = await readJson(request);
    const state = await loadState();
    const index = state.instances.findIndex((item) => item.instanceId === instanceId);
    if (index === -1 || !canAccessInstance(secured.roles, secured.tenantId, state.instances[index]!)) {
      sendJson(response, 404, { error: "plugin_instance_not_found" }, context.requestId);
      return;
    }

    const built = authorizeInstance(state.instances[index]!, body);
    if (!built.instance) {
      sendJson(response, 400, { error: built.error ?? "invalid_authorize_payload" }, context.requestId);
      return;
    }

    state.instances[index] = built.instance;
    await saveState(state);
    sendJson(response, 200, built.instance, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/plugins\/instances\/[^/]+\/test$/.test(pathname)) {
    const secured = enforceSecurity(request, response, {
      requireActor: true,
      requireTenant: true,
      requiredRoles: pluginInstanceManageRoles
    }, context);
    if (!secured) return;
    const instanceId = pathname.split("/")[4] ?? "";
    const state = await loadState();
    const index = state.instances.findIndex((item) => item.instanceId === instanceId);
    if (index === -1 || !canAccessInstance(secured.roles, secured.tenantId, state.instances[index]!)) {
      sendJson(response, 404, { error: "plugin_instance_not_found" }, context.requestId);
      return;
    }

    const built = testInstance(state.instances[index]!);
    if (!built.instance) {
      state.instances[index] = updateInstance(state.instances[index]!, {
        status: "unhealthy",
        lastTestAt: now(),
        lastTestStatus: "failed",
        lastTestMessage: built.error ?? "instance_test_failed"
      });
      await saveState(state);
      sendJson(response, 409, { error: built.error ?? "instance_test_failed", instance: state.instances[index] }, context.requestId);
      return;
    }

    state.instances[index] = built.instance;
    await saveState(state);
    sendJson(response, 200, built.instance, context.requestId);
    return;
  }

  sendJson(response, 404, { error: "not_found", service: descriptor.serviceName, path: pathname }, context.requestId);
};

export const createAppServer = () =>
  createServer((request, response) => {
    void requestHandler(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" }, parseContext(request).requestId);
    });
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer();
  server.listen(descriptor.listeningPort, () => {
    console.log(descriptor.serviceName + " listening on :" + descriptor.listeningPort);
  });
}
