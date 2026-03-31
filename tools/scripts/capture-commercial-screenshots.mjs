#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const screenshotDir = path.join(repoRoot, "docs", "assets", "screenshots");

const requestedPorts = {
  gateway: Number(process.env.OPENAEGIS_SCREENSHOT_API_PORT ?? 4300),
  frontend: Number(process.env.OPENAEGIS_SCREENSHOT_UI_PORT ?? 4700)
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const requiredShots = [
  "commercial-setup.png",
  "commercial-dashboard.png",
  "commercial-readiness.png",
  "commercial-integrations.png",
  "commercial-identity.png",
  "commercial-security.png",
  "commercial-approvals.png",
  "commercial-incidents.png",
  "commercial-audit.png",
  "commercial-simulation.png",
  "commercial-workflow.png",
  "commercial-admin.png"
];

const log = (message) => {
  process.stdout.write(`[capture-commercial] ${message}\n`);
};

const isPortFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port }, () => {
      server.close(() => resolve(true));
    });
  });

const findAvailablePort = async (startPort, attempts = 30) => {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`no_available_port_from_${startPort}`);
};

const spawnCrossPlatform = (command, args, options = {}) =>
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], options)
    : spawn(command, args, options);

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, {
      cwd: repoRoot,
      stdio: "pipe",
      env: process.env,
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
      }
    });
  });

const startService = (name, command, args, options = {}) => {
  const child = spawnCrossPlatform(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    ...options
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk.toString()}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk.toString()}`));
  child.on("error", (error) => process.stderr.write(`[${name}] error: ${error.message}\n`));

  return child;
};

const stopService = async (child) => {
  if (!child || child.exitCode !== null) return;

  if (process.platform === "win32" && typeof child.pid === "number") {
    await runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => undefined);
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([once(child, "close"), delay(5_000)]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "close"), delay(3_000)]);
  }
};

const waitForHttp = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // service booting
    }
    await delay(400);
  }
  throw new Error(`timeout_waiting_for_http:${url}`);
};

const clearOldCommercialShots = async () => {
  await mkdir(screenshotDir, { recursive: true });
  const files = await readdir(screenshotDir);
  await Promise.all(
    files
      .filter((file) => file.startsWith("commercial-") && file.endsWith(".png"))
      .map((file) => rm(path.join(screenshotDir, file), { force: true }))
  );
};

const verifyOutputs = async () => {
  const checks = [];
  for (const name of requiredShots) {
    const absolute = path.join(screenshotDir, name);
    const details = await stat(absolute);
    if (details.size <= 0) {
      throw new Error(`empty_screenshot:${absolute}`);
    }
    checks.push({ name, size: details.size });
  }
  return checks;
};

const waitForHeading = async (page, heading) => {
  await page.getByRole("heading", { name: heading }).first().waitFor({ state: "visible", timeout: 15_000 });
};

const captureRoute = async (page, appBaseUrl, route, heading, filename) => {
  await page.goto(`${appBaseUrl}${route}`, { waitUntil: "networkidle" });
  await waitForHeading(page, heading);
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
};

export const captureCommercialScreenshots = async () => {
  const ports = {
    gateway: await findAvailablePort(requestedPorts.gateway),
    frontend: await findAvailablePort(requestedPorts.frontend)
  };
  const urls = {
    api: `http://127.0.0.1:${ports.gateway}`,
    app: `http://127.0.0.1:${ports.frontend}`
  };

  log("Resetting screenshot outputs and demo state");
  await clearOldCommercialShots();
  await rm(path.join(repoRoot, ".volumes", "pilot-state.json"), { force: true });
  await rm(path.join(repoRoot, ".volumes", "tool-execution-state.json"), { force: true });

  log("Building admin-console preview bundle");
  await runCommand(npmCmd, ["run", "--workspace", "@openaegis/admin-console", "build"], {
    env: {
      ...process.env,
      VITE_API_URL: urls.api
    }
  });

  log(`Starting API gateway on :${ports.gateway}`);
  const gateway = startService("gateway", "node", ["tools/scripts/run-gateway.mjs"], {
    env: {
      ...process.env,
      PORT: String(ports.gateway),
      OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH: "true"
    }
  });

  log(`Starting frontend preview on :${ports.frontend}`);
  const preview = startService(
    "preview",
    npmCmd,
    ["exec", "--workspace", "@openaegis/admin-console", "--", "vite", "preview", "--host", "127.0.0.1", "--port", String(ports.frontend), "--strictPort"]
  );

  let browser;
  try {
    log("Waiting for gateway and UI to be ready");
    await waitForHttp(`${urls.api}/healthz`);
    await waitForHttp(`${urls.app}/setup`);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
    const page = await context.newPage();

    log("Seeding state through UI interactions");
    await page.goto(`${urls.app}/setup`, { waitUntil: "networkidle" });
    await waitForHeading(page, "Setup Center");

    await page
      .getByRole("complementary")
      .getByRole("button", { name: /Connect evaluator identities|Reconnect evaluator identities|Connect demo sessions|Reconnect demo sessions/i })
      .first()
      .click();
    await page.getByText("Clinician connected").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText("Security connected").waitFor({ state: "visible", timeout: 20_000 });

    await page.goto(`${urls.app}/dashboard`, { waitUntil: "networkidle" });
    await waitForHeading(page, "Business KPI Dashboard");

    await page.getByRole("button", { name: "Run simulation" }).first().click();
    await page.waitForTimeout(1_000);
    await page.getByRole("button", { name: "Run live workflow" }).first().click();
    await page.waitForTimeout(1_500);

    await captureRoute(page, urls.app, "/dashboard", "Business KPI Dashboard", "commercial-dashboard.png");
    await captureRoute(page, urls.app, "/setup", "Setup Center", "commercial-setup.png");
    await captureRoute(page, urls.app, "/workflows", "Workflow Designer", "commercial-workflow.png");
    await captureRoute(page, urls.app, "/simulation", "Simulation Lab", "commercial-simulation.png");

    await page.getByRole("button", { name: "Security" }).first().click();
    await page.waitForTimeout(400);

    await page.goto(`${urls.app}/security`, { waitUntil: "networkidle" });
    await waitForHeading(page, "Security Console");
    const approvalToggle = page.getByLabel("Require human approval for high-risk live actions");
    if (await approvalToggle.isVisible().catch(() => false)) {
      await approvalToggle.uncheck();
      await page.getByRole("button", { name: "Preview impact" }).first().click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Ask copilot" }).first().click();
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: path.join(screenshotDir, "commercial-security.png"), fullPage: true });
    await captureRoute(page, urls.app, "/integrations", "Integration Hub", "commercial-integrations.png");
    await captureRoute(page, urls.app, "/identity", "Identity & Access", "commercial-identity.png");
    await captureRoute(page, urls.app, "/approvals", "Approval Inbox", "commercial-approvals.png");

    const rejectButton = page.getByRole("button", { name: "Reject" });
    const canReject = await rejectButton.isVisible().then(() => rejectButton.isEnabled()).catch(() => false);
    if (canReject) {
      await rejectButton.click();
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: path.join(screenshotDir, "commercial-approvals.png"), fullPage: true });
    }

    await captureRoute(page, urls.app, "/incidents", "Incident Review Explorer", "commercial-incidents.png");
    await captureRoute(page, urls.app, "/audit", "Audit Explorer", "commercial-audit.png");
    await captureRoute(page, urls.app, "/commercial", "Commercial Readiness", "commercial-readiness.png");
    await captureRoute(page, urls.app, "/admin", "Admin Console", "commercial-admin.png");

    await context.close();
    await browser.close();
    browser = undefined;
  } finally {
    if (browser) {
      await browser.close();
    }
    await Promise.allSettled([stopService(preview), stopService(gateway)]);
  }

  log("Verifying screenshot files");
  const outputs = await verifyOutputs();
  process.stdout.write("Commercial screenshots captured:\n");
  for (const item of outputs) {
    process.stdout.write(`- docs/assets/screenshots/${item.name} (${item.size} bytes)\n`);
  }
};

const invokedDirectly = process.argv[1]
  ? path.basename(process.argv[1]).toLowerCase() === "capture-commercial-screenshots.mjs"
  : false;

if (invokedDirectly) {
  captureCommercialScreenshots().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

