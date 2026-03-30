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
  serviceName: "classification-service",
  listeningPort: Number(process.env.PORT ?? 3010),
  purpose: "PHI/PII/DLP classification and deterministic redaction",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

interface ClassificationRecord {
  classificationId: string;
  tenantId: string;
  actorId: string;
  textHash: string;
  classes: DataClass[];
  dominantClass: DataClass;
  riskScore: number;
  findings: string[];
  redactedText: string;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
}

interface ClassificationState {
  version: number;
  events: ClassificationRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "classification-service-state.json");
const limiter = new InMemoryRateLimiter(150, 60_000);
const classOrder: DataClass[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PHI", "EPHI", "SECRET"];

const normalizeState = (state: Partial<ClassificationState> | undefined): ClassificationState => ({
  version: 1,
  events: Array.isArray(state?.events) ? state.events : []
});

const loadState = async (): Promise<ClassificationState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<ClassificationState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: ClassificationState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const normalizeMetadata = (value: unknown): Record<string, string | number | boolean> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0) continue;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      metadata[normalizedKey] = entry;
    }
  }
  return metadata;
};

const addClass = (classes: Set<DataClass>, value: DataClass) => {
  classes.add(value);
};

const redact = (text: string): string =>
  text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:mrn|patient\s*id|member\s*id)\s*[:#-]?\s*[a-z0-9-]{4,}\b/gi, "[REDACTED_MEDICAL_ID]")
    .replace(/\b\d{10,16}\b/g, "[REDACTED_LONG_NUMBER]");

const calculateRisk = (classes: Set<DataClass>, findingsCount: number): number => {
  let base = 0;
  if (classes.has("SECRET")) base = 95;
  else if (classes.has("EPHI")) base = 88;
  else if (classes.has("PHI")) base = 80;
  else if (classes.has("PII")) base = 68;
  else if (classes.has("CONFIDENTIAL")) base = 50;
  else if (classes.has("INTERNAL")) base = 25;
  return Math.min(100, base + Math.min(12, findingsCount * 3));
};

const dominantClass = (classes: Set<DataClass>): DataClass => {
  let winner: DataClass = "PUBLIC";
  for (const item of classOrder) {
    if (classes.has(item)) winner = item;
  }
  return winner;
};

const classifyText = (text: string, metadata: Record<string, string | number | boolean>) => {
  const classes = new Set<DataClass>();
  const findings: string[] = [];
  const lower = text.toLowerCase();

  if (metadata.source === "internal" || metadata.channel === "internal") {
    addClass(classes, "INTERNAL");
  } else {
    addClass(classes, "PUBLIC");
  }

  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    addClass(classes, "PII");
    findings.push("contains_ssn_pattern");
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) {
    addClass(classes, "PII");
    findings.push("contains_email_pattern");
  }
  if (/\b(?:mrn|patient\s*id|member\s*id)\s*[:#-]?\s*[a-z0-9-]{4,}\b/i.test(text)) {
    addClass(classes, "PHI");
    findings.push("contains_medical_identifier");
  }
  if (/\b(?:diagnosis|medication|discharge|allergy|vitals|treatment|clinical)\b/i.test(text)) {
    addClass(classes, "PHI");
    findings.push("contains_clinical_terms");
  }
  if (/\b(?:ehr|ephi|fhir|hl7)\b/i.test(text)) {
    addClass(classes, "EPHI");
    findings.push("contains_electronic_health_terms");
  }
  if (/\b(?:password|private\s*key|secret\s*key|api\s*token)\b/i.test(text)) {
    addClass(classes, "SECRET");
    findings.push("contains_secret_material");
  }
  if (metadata.classification === "CONFIDENTIAL") {
    addClass(classes, "CONFIDENTIAL");
    findings.push("metadata_confidential_flag");
  }

  const redactedText = redact(text);
  const dominant = dominantClass(classes);
  return {
    classes: classOrder.filter((item) => classes.has(item)),
    dominantClass: dominant,
    findings,
    redactedText,
    riskScore: calculateRisk(classes, findings.length)
  };
};

const createClassificationId = (
  tenantId: string,
  actorId: string,
  textHash: string,
  metadata: Record<string, string | number | boolean>,
  sequence: number
) => `cls-${sha256Hex(stableSerialize({ tenantId, actorId, textHash, metadata, sequence })).slice(0, 18)}`;

export const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? "GET";
  const parsedUrl = new URL(request.url ?? "/", "http://localhost");
  const endpoint = parsedUrl.pathname;
  const context = parseContext(request);

  const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${endpoint}`;
  if (!enforceRateLimit(response, context.requestId, limiter.check(rateKey))) return;

  if (method === "GET" && endpoint === "/healthz") {
    const state = await loadState();
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, events: state.events.length }, context.requestId);
    return;
  }

  if (method === "POST" && endpoint === "/v1/classification/classify") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["workflow_operator", "analyst", "security_admin", "platform_admin"] },
      context
    );
    if (!secured) return;

    const body = await readJson(request, 128 * 1024);
    const text = toString(body.text);
    if (!text) {
      sendJson(response, 400, { error: "text_required" }, context.requestId);
      return;
    }
    if (text.length > 20_000) {
      sendJson(response, 400, { error: "text_too_large" }, context.requestId);
      return;
    }

    const metadata = normalizeMetadata(body.metadata);
    if (!metadata) {
      sendJson(response, 400, { error: "invalid_metadata" }, context.requestId);
      return;
    }

    const classified = classifyText(text, metadata);
    const state = await loadState();
    const textHash = sha256Hex(text);

    const event: ClassificationRecord = {
      classificationId: createClassificationId(
        secured.tenantId ?? "unknown",
        secured.actorId ?? "unknown",
        textHash,
        metadata,
        state.events.length + 1
      ),
      tenantId: secured.tenantId ?? "unknown",
      actorId: secured.actorId ?? "unknown",
      textHash,
      classes: classified.classes,
      dominantClass: classified.dominantClass,
      riskScore: classified.riskScore,
      findings: classified.findings,
      redactedText: classified.redactedText,
      metadata,
      createdAt: nowIso()
    };

    state.events.push(event);
    await saveState(state);

    sendJson(
      response,
      200,
      {
        classificationId: event.classificationId,
        classes: event.classes,
        dominantClass: event.dominantClass,
        riskScore: event.riskScore,
        findings: event.findings,
        redactedText: event.redactedText,
        textHash: event.textHash
      },
      context.requestId
    );
    return;
  }

  if (method === "GET" && endpoint === "/v1/classification/events") {
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

    const events = state.events
      .filter((event) => event.tenantId === secured.tenantId)
      .slice()
      .reverse()
      .slice(0, limit);

    sendJson(response, 200, { events }, context.requestId);
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
