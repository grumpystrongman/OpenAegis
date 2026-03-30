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
  serviceName: "context-retrieval-service",
  listeningPort: Number(process.env.PORT ?? 3009),
  purpose: "Classified retrieval index and policy-aware query assembly",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

interface IndexedDocument {
  docId: string;
  tenantId: string;
  title: string;
  content: string;
  dataClass: DataClass;
  source: string;
  allowedRoles: string[];
  purposeTags: string[];
  tokens: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface QueryLog {
  queryId: string;
  tenantId: string;
  actorId: string;
  query: string;
  purpose?: string;
  limit: number;
  returnedDocIds: string[];
  appliedFilters: string[];
  createdAt: string;
}

interface ContextRetrievalState {
  version: number;
  documents: IndexedDocument[];
  queries: QueryLog[];
}

const stateFile = resolve(process.cwd(), ".volumes", "context-retrieval-service-state.json");
const limiter = new InMemoryRateLimiter(120, 60_000);

const classOrder: DataClass[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PHI", "EPHI", "SECRET"];

const normalizeState = (state: Partial<ContextRetrievalState> | undefined): ContextRetrievalState => ({
  version: 1,
  documents: Array.isArray(state?.documents) ? state.documents : [],
  queries: Array.isArray(state?.queries) ? state.queries : []
});

const loadState = async (): Promise<ContextRetrievalState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<ContextRetrievalState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: ContextRetrievalState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toDataClass = (value: unknown): DataClass =>
  value === "INTERNAL" ||
  value === "CONFIDENTIAL" ||
  value === "PII" ||
  value === "PHI" ||
  value === "EPHI" ||
  value === "SECRET"
    ? value
    : "PUBLIC";

const tokenize = (value: string): string[] =>
  Array.from(new Set((value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).slice(0, 1200)));

const normalizeStringArray = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map(toString)
    .filter((item): item is string => item !== undefined && item.length <= maxLength)
    .map((item) => item.toLowerCase())
    .slice(0, maxItems);
  return Array.from(new Set(normalized));
};

const canReadDataClass = (roles: string[], dataClass: DataClass): boolean => {
  if (dataClass === "PUBLIC" || dataClass === "INTERNAL") return true;
  if (dataClass === "CONFIDENTIAL") {
    return roles.some((role) => role === "analyst" || role === "workflow_operator" || role === "security_admin" || role === "platform_admin");
  }
  if (dataClass === "PII" || dataClass === "PHI" || dataClass === "EPHI") {
    return roles.some((role) => role === "workflow_operator" || role === "security_admin" || role === "platform_admin");
  }
  return roles.some((role) => role === "security_admin" || role === "platform_admin");
};

const hasRoleAccess = (roles: string[], allowedRoles: string[]): boolean => {
  if (allowedRoles.length === 0) return true;
  return roles.some((role) => allowedRoles.includes(role.toLowerCase()));
};

const matchesPurpose = (purposeTags: string[], requestedPurpose: string | undefined): boolean => {
  if (purposeTags.length === 0) return true;
  if (!requestedPurpose) return false;
  return purposeTags.includes(requestedPurpose.toLowerCase());
};

const scoreDocument = (queryTokens: string[], document: IndexedDocument): number => {
  if (queryTokens.length === 0) return 0;
  const tokenSet = new Set(document.tokens);
  let overlap = 0;
  for (const token of queryTokens) {
    if (tokenSet.has(token)) overlap += 1;
  }
  const lexicalScore = overlap / queryTokens.length;
  const titleBoost = queryTokens.some((token) => document.title.toLowerCase().includes(token)) ? 0.15 : 0;
  return Number(Math.min(1, lexicalScore + titleBoost).toFixed(4));
};

const parseIndexPayload = (body: JsonMap): Omit<IndexedDocument, "tenantId" | "createdBy" | "createdAt" | "updatedAt" | "tokens"> | undefined => {
  const docId = toString(body.docId);
  const title = toString(body.title);
  const content = toString(body.content);
  if (!docId || !title || !content) return undefined;
  if (docId.length > 120 || title.length > 200 || content.length > 40_000) return undefined;

  const source = toString(body.source) ?? "manual";
  const allowedRoles = normalizeStringArray(body.allowedRoles, 10, 60);
  const purposeTags = normalizeStringArray(body.purposeTags, 20, 80);

  return {
    docId,
    title,
    content,
    dataClass: toDataClass(body.dataClass),
    source,
    allowedRoles,
    purposeTags
  };
};

const parseAllowedDataClasses = (value: unknown): DataClass[] => {
  if (!Array.isArray(value)) return [];
  const classes = value.map(toDataClass);
  return classOrder.filter((item) => classes.includes(item));
};

const createQueryId = (tenantId: string, actorId: string, query: string, sequence: number): string =>
  `qry-${sha256Hex(stableSerialize({ tenantId, actorId, query, sequence })).slice(0, 18)}`;

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
      {
        status: "ok",
        service: descriptor.serviceName,
        indexedDocuments: state.documents.length,
        queryEvents: state.queries.length
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && endpoint === "/v1/context/index") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const body = await readJson(request, 256 * 1024);
    const parsed = parseIndexPayload(body);
    if (!parsed) {
      sendJson(response, 400, { error: "invalid_index_payload" }, context.requestId);
      return;
    }

    const state = await loadState();
    const now = nowIso();
    const document: IndexedDocument = {
      ...parsed,
      tenantId: secured.tenantId ?? "unknown",
      createdBy: secured.actorId ?? "unknown",
      createdAt: now,
      updatedAt: now,
      tokens: tokenize(`${parsed.title} ${parsed.content}`)
    };

    const existing = state.documents.findIndex(
      (current) => current.tenantId === document.tenantId && current.docId === document.docId
    );

    if (existing >= 0) {
      const previous = state.documents[existing]!;
      state.documents[existing] = {
        ...document,
        createdAt: previous.createdAt,
        createdBy: previous.createdBy
      };
    } else {
      state.documents.push(document);
    }

    await saveState(state);
    sendJson(
      response,
      existing >= 0 ? 200 : 201,
      {
        document: {
          docId: document.docId,
          title: document.title,
          dataClass: document.dataClass,
          source: document.source,
          allowedRoles: document.allowedRoles,
          purposeTags: document.purposeTags,
          updatedAt: document.updatedAt
        }
      },
      context.requestId
    );
    return;
  }

  if (method === "POST" && endpoint === "/v1/context/query") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "analyst", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const body = await readJson(request, 128 * 1024);
    const query = toString(body.query);
    if (!query || query.length > 300) {
      sendJson(response, 400, { error: "query_required_or_too_long" }, context.requestId);
      return;
    }

    const purpose = toString(body.purpose)?.toLowerCase();
    const limitRaw = typeof body.limit === "number" ? body.limit : 5;
    const limit = Math.max(1, Math.min(20, Math.floor(limitRaw)));
    const allowedDataClasses = parseAllowedDataClasses(body.allowedDataClasses);
    const queryTokens = tokenize(query);

    const state = await loadState();
    const appliedFilters: string[] = ["tenant_scope", "role_scope", "purpose_scope", "data_class_scope"];

    const filtered = state.documents
      .filter((document) => document.tenantId === secured.tenantId)
      .filter((document) => hasRoleAccess(secured.roles, document.allowedRoles))
      .filter((document) => canReadDataClass(secured.roles, document.dataClass))
      .filter((document) => matchesPurpose(document.purposeTags, purpose))
      .filter((document) => (allowedDataClasses.length > 0 ? allowedDataClasses.includes(document.dataClass) : true))
      .map((document) => ({
        document,
        score: scoreDocument(queryTokens, document)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.document.updatedAt.localeCompare(left.document.updatedAt);
      })
      .slice(0, limit);

    const results = filtered.map((item) => ({
      docId: item.document.docId,
      title: item.document.title,
      dataClass: item.document.dataClass,
      source: item.document.source,
      score: item.score,
      snippet: item.document.content.slice(0, 280),
      updatedAt: item.document.updatedAt
    }));

    const queryRecord: QueryLog = {
      queryId: createQueryId(
        secured.tenantId ?? "unknown",
        secured.actorId ?? "unknown",
        query,
        state.queries.length + 1
      ),
      tenantId: secured.tenantId ?? "unknown",
      actorId: secured.actorId ?? "unknown",
      query,
      ...(purpose ? { purpose } : {}),
      limit,
      returnedDocIds: results.map((result) => result.docId),
      appliedFilters,
      createdAt: nowIso()
    };

    state.queries.push(queryRecord);
    await saveState(state);

    sendJson(
      response,
      200,
      {
        queryId: queryRecord.queryId,
        resultCount: results.length,
        results,
        appliedFilters
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && endpoint === "/v1/context/documents") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["auditor", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const state = await loadState();
    const limitRaw = Number(parsedUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

    const documents = state.documents
      .filter((document) => document.tenantId === secured.tenantId)
      .slice()
      .reverse()
      .slice(0, limit)
      .map((document) => ({
        docId: document.docId,
        title: document.title,
        dataClass: document.dataClass,
        source: document.source,
        allowedRoles: document.allowedRoles,
        purposeTags: document.purposeTags,
        updatedAt: document.updatedAt
      }));

    sendJson(response, 200, { documents }, context.requestId);
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
