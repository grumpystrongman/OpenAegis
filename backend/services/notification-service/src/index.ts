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
  type JsonMap
} from "@openaegis/security-kit";

export const descriptor: ServiceDescriptor = {
  serviceName: "notification-service",
  listeningPort: 3013,
  purpose: "Approval and incident notifications",
  securityTier: "regulated",
  requiresMTLS: true,
  requiresTenantContext: true,
  defaultDeny: true
};

type NotificationStatus = "queued" | "sent" | "failed" | "acknowledged";
type NotificationChannel = "email" | "in-app" | "webhook";

interface NotificationRecord {
  notificationId: string;
  tenantId: string;
  recipient: string;
  subject: string;
  body: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  metadata: Record<string, unknown>;
}

interface NotificationState {
  version: number;
  notifications: NotificationRecord[];
}

const stateFile = resolve(process.cwd(), ".volumes", "notification-service-state.json");
const limiter = new InMemoryRateLimiter(150, 60_000);

const normalizeState = (state: Partial<NotificationState> | undefined): NotificationState => ({
  version: 1,
  notifications: Array.isArray(state?.notifications) ? state.notifications : []
});

const loadState = async (): Promise<NotificationState> => {
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")) as Partial<NotificationState>);
  } catch {
    return normalizeState(undefined);
  }
};

const saveState = async (state: NotificationState): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
};

const toString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toChannel = (value: unknown): NotificationChannel =>
  value === "email" || value === "in-app" || value === "webhook" ? value : "in-app";

const isAdmin = (roles: string[]) => roles.includes("platform_admin") || roles.includes("security_admin");

const summarizeHealth = (notifications: NotificationRecord[]) => {
  const counts = notifications.reduce<Record<string, number>>((accumulator, notification) => {
    accumulator[notification.status] = (accumulator[notification.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    totalNotifications: notifications.length,
    queuedNotifications: counts.queued ?? 0,
    sentNotifications: counts.sent ?? 0,
    failedNotifications: counts.failed ?? 0,
    acknowledgedNotifications: counts.acknowledged ?? 0,
    lastUpdatedAt: notifications.reduce((latest, notification) => (notification.updatedAt > latest ? notification.updatedAt : latest), "")
  };
};

const findNotification = (notifications: NotificationRecord[], tenantId: string, notificationId: string) =>
  notifications.find((notification) => notification.tenantId === tenantId && notification.notificationId === notificationId);

const createNotificationId = () => `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
    sendJson(response, 200, { status: "ok", service: descriptor.serviceName, ...summarizeHealth(state.notifications) }, context.requestId);
    return;
  }

  if (method === "GET" && path === "/v1/notifications") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin", "auditor", "workflow_operator"] },
      context
    );
    if (!secured) return;
    const state = await loadState();
    const notifications = state.notifications
      .filter((notification) => notification.tenantId === secured.tenantId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    sendJson(response, 200, { notifications, metrics: summarizeHealth(notifications) }, context.requestId);
    return;
  }

  if (method === "GET" && /^\/v1\/notifications\/[^/]+$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin", "auditor", "workflow_operator"] },
      context
    );
    if (!secured) return;
    const notificationId = path.split("/")[3] ?? "";
    const state = await loadState();
    const notification = findNotification(state.notifications, secured.tenantId ?? "", notificationId);
    if (!notification) {
      sendJson(response, 404, { error: "notification_not_found" }, context.requestId);
      return;
    }
    sendJson(response, 200, notification, context.requestId);
    return;
  }

  if (method === "POST" && path === "/v1/notifications") {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const body = await readJson(request);
    const recipient = toString(body.recipient);
    const subject = toString(body.subject);
    const messageBody = toString(body.body);
    if (!recipient || !subject || !messageBody) {
      sendJson(response, 400, { error: "missing_required_notification_fields" }, context.requestId);
      return;
    }

    const now = nowIso();
    const notification: NotificationRecord = {
      notificationId: createNotificationId(),
      tenantId: secured.tenantId ?? "unknown",
      recipient,
      subject,
      body: messageBody,
      channel: toChannel(body.channel),
      status: "queued",
      createdBy: secured.actorId ?? "unknown",
      createdAt: now,
      updatedAt: now,
      metadata: typeof body.metadata === "object" && body.metadata !== null ? (body.metadata as Record<string, unknown>) : {}
    };
    const state = await loadState();
    state.notifications.push(notification);
    await saveState(state);
    sendJson(response, 201, notification, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/notifications\/[^/]+\/send$/.test(path)) {
    const secured = enforceSecurity(
      request,
      response,
      { requireActor: true, requireTenant: true, requiredRoles: ["platform_admin", "security_admin"] },
      context
    );
    if (!secured) return;
    const notificationId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.notifications.findIndex((notification) => notification.tenantId === secured.tenantId && notification.notificationId === notificationId);
    if (index < 0) {
      sendJson(response, 404, { error: "notification_not_found" }, context.requestId);
      return;
    }

    const current = state.notifications[index]!;
    if (current.status !== "queued") {
      sendJson(response, 409, { error: "notification_not_queued" }, context.requestId);
      return;
    }

    const sentAt = nowIso();
    const updated: NotificationRecord = {
      ...current,
      status: "sent",
      sentAt,
      updatedAt: sentAt
    };
    state.notifications[index] = updated;
    await saveState(state);
    sendJson(response, 200, updated, context.requestId);
    return;
  }

  if (method === "POST" && /^\/v1\/notifications\/[^/]+\/ack$/.test(path)) {
    const secured = enforceSecurity(request, response, { requireActor: true, requireTenant: true }, context);
    if (!secured) return;
    const notificationId = path.split("/")[3] ?? "";
    const state = await loadState();
    const index = state.notifications.findIndex((notification) => notification.tenantId === secured.tenantId && notification.notificationId === notificationId);
    if (index < 0) {
      sendJson(response, 404, { error: "notification_not_found" }, context.requestId);
      return;
    }
    const current = state.notifications[index]!;
    const acknowledgedAt = nowIso();
    const updated: NotificationRecord = {
      ...current,
      status: "acknowledged",
      acknowledgedAt,
      updatedAt: acknowledgedAt
    };
    state.notifications[index] = updated;
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

