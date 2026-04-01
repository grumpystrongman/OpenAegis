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
  toolRegistry: Number(process.env.OPENAEGIS_SCREENSHOT_TOOL_REGISTRY_PORT ?? 4301),
  frontend: Number(process.env.OPENAEGIS_SCREENSHOT_UI_PORT ?? 4700)
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const requiredShots = [
  "commercial-setup.png",
  "commercial-dashboard.png",
  "commercial-projects.png",
  "commercial-sandbox-proof.png",
  "commercial-project-guide-secops-runtime-guard.png",
  "commercial-project-guide-revenue-cycle-copilot.png",
  "commercial-project-guide-supply-chain-resilience.png",
  "commercial-project-guide-clinical-quality-signal.png",
  "commercial-project-guide-board-risk-cockpit.png",
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

const projectGuideShots = [
  {
    packId: "secops-runtime-guard",
    heading: "SecOps Runtime Guard",
    filename: "commercial-project-guide-secops-runtime-guard.png"
  },
  {
    packId: "revenue-cycle-copilot",
    heading: "Revenue Cycle Copilot",
    filename: "commercial-project-guide-revenue-cycle-copilot.png"
  },
  {
    packId: "supply-chain-resilience",
    heading: "Supply Chain Resilience",
    filename: "commercial-project-guide-supply-chain-resilience.png"
  },
  {
    packId: "clinical-quality-signal",
    heading: "Clinical Quality Signal",
    filename: "commercial-project-guide-clinical-quality-signal.png"
  },
  {
    packId: "board-risk-cockpit",
    heading: "Board Risk Cockpit",
    filename: "commercial-project-guide-board-risk-cockpit.png"
  }
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

const navigateToRoute = async (page, route) => {
  const navLink = page.locator(`a[href='${route}']`).first();
  if ((await navLink.count()) > 0 && await navLink.isVisible().catch(() => false)) {
    await navLink.click();
  } else {
    await page.evaluate((targetRoute) => {
      window.history.pushState({}, "", targetRoute);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, route);
  }
  await page.waitForLoadState("networkidle");
};

const captureRoute = async (page, route, heading, filename) => {
  await navigateToRoute(page, route);
  await waitForHeading(page, heading);
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
};

const captureProjectGuide = async (page, packId, heading, filename) => {
  await navigateToRoute(page, "/projects");
  await waitForHeading(page, "Commercial Project Packs");
  const packCard = page.locator(".scenario-card").filter({ hasText: heading }).first();
  if ((await packCard.count()) === 0) {
    await page.getByRole("button", { name: /Refresh live data/i }).first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);
  }
  await packCard.waitFor({ state: "visible", timeout: 20_000 });
  await packCard.click();
  await page.locator(`a[href='/project-guide?pack=${packId}']`).first().click();
  await page.waitForLoadState("networkidle");
  await waitForHeading(page, heading);
  await page.getByText("Seeded business data").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
};

export const captureCommercialScreenshots = async () => {
  const ports = {
    gateway: await findAvailablePort(requestedPorts.gateway),
    toolRegistry: await findAvailablePort(requestedPorts.toolRegistry),
    frontend: await findAvailablePort(requestedPorts.frontend)
  };
  const urls = {
    api: `http://127.0.0.1:${ports.gateway}`,
    toolRegistry: `http://127.0.0.1:${ports.toolRegistry}`,
    app: `http://127.0.0.1:${ports.frontend}`
  };

  log("Resetting screenshot outputs and demo state");
  await clearOldCommercialShots();
  await rm(path.join(repoRoot, ".volumes", "pilot-state.json"), { force: true });
  await rm(path.join(repoRoot, ".volumes", "tool-execution-state.json"), { force: true });

  log("Building admin-console preview bundle");
  await runCommand(npmCmd, ["run", "--workspace", "@openaegis/api-gateway", "build"]);
  await runCommand(npmCmd, ["run", "--workspace", "@openaegis/tool-registry", "build"]);
  await runCommand(npmCmd, ["run", "--workspace", "@openaegis/admin-console", "build"], {
    env: {
      ...process.env,
      VITE_API_URL: urls.api,
      VITE_TOOL_REGISTRY_URL: urls.toolRegistry,
      VITE_ENABLE_DEMO_IDENTITIES: "true"
    }
  });

  log(`Starting tool-registry on :${ports.toolRegistry}`);
  const toolRegistry = startService("tool-registry", "node", ["tools/scripts/run-tool-registry.mjs"], {
    env: {
      ...process.env,
      PORT: String(ports.toolRegistry)
    }
  });

  log(`Starting API gateway on :${ports.gateway}`);
  const gateway = startService("gateway", "node", ["tools/scripts/run-gateway.mjs"], {
    env: {
      ...process.env,
      PORT: String(ports.gateway),
      OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH: "true",
      OPENAEGIS_ALLOWED_ORIGINS: urls.app
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
    await waitForHttp(`${urls.toolRegistry}/healthz`);
    await waitForHttp(`${urls.api}/healthz`);
    await waitForHttp(`${urls.app}/setup`);

    browser = await chromium.launch({
      headless: true,
      args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"]
    });
    const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
    const page = await context.newPage();

    log("Seeding state through UI interactions");
    await page.goto(`${urls.app}/setup`, { waitUntil: "networkidle" });
    await waitForHeading(page, "Setup Center");

    await page
      .getByRole("button", { name: /Connect evaluator identities|Reconnect evaluator identities|Connect demo sessions|Reconnect demo sessions/i })
      .first()
      .click();
    try {
      await page.getByText("Clinician connected").waitFor({ state: "visible", timeout: 20_000 });
      await page.getByText("Security connected").waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      const errorBanner = page.locator(".banner.error").first();
      const errorText = (await errorBanner.isVisible().catch(() => false))
        ? await errorBanner.textContent()
        : "no_error_banner";
      throw new Error(`unable_to_connect_demo_identities:${String(errorText).trim()}`);
    }

    await navigateToRoute(page, "/dashboard");
    const dashboardHeadings = await page.getByRole("heading").allInnerTexts().catch(() => []);
    if (!dashboardHeadings.some((heading) => heading.includes("Business KPI Dashboard"))) {
      const errorBanner = page.locator(".banner.error").first();
      const errorText = (await errorBanner.isVisible().catch(() => false))
        ? await errorBanner.textContent()
        : "no_error_banner";
      throw new Error(
        `dashboard_navigation_failed:url=${page.url()};headings=${dashboardHeadings.join(" | ")};error=${String(errorText).trim()}`
      );
    }
    await waitForHeading(page, "Business KPI Dashboard");

    await page.getByRole("button", { name: "Run simulation" }).first().click();
    await page.waitForTimeout(1_000);
    await page.getByRole("button", { name: "Run live workflow" }).first().click();
    await page.waitForTimeout(1_500);

    await captureRoute(page, "/dashboard", "Business KPI Dashboard", "commercial-dashboard.png");
    await captureRoute(page, "/projects", "Commercial Project Packs", "commercial-projects.png");
    await navigateToRoute(page, "/sandbox-proof");
    await waitForHeading(page, "Sandbox Proof");
    await page.getByText("SecOps Runtime Guard").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({ path: path.join(screenshotDir, "commercial-sandbox-proof.png"), fullPage: true });
    await captureRoute(page, "/setup", "Setup Center", "commercial-setup.png");
    await captureRoute(page, "/workflows", "Workflow Designer", "commercial-workflow.png");
    await captureRoute(page, "/simulation", "Simulation Lab", "commercial-simulation.png");

    for (const projectGuideShot of projectGuideShots) {
      await captureProjectGuide(
        page,
        projectGuideShot.packId,
        projectGuideShot.heading,
        projectGuideShot.filename
      );
    }

    await page.getByRole("button", { name: "Security" }).first().click();
    await page.waitForTimeout(400);

    await navigateToRoute(page, "/security");
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
    await captureRoute(page, "/integrations", "Integration Hub", "commercial-integrations.png");
    await captureRoute(page, "/identity", "Identity & Access", "commercial-identity.png");
    await captureRoute(page, "/approvals", "Approval Inbox", "commercial-approvals.png");

    const rejectButton = page.getByRole("button", { name: "Reject" });
    const canReject = await rejectButton.isVisible().then(() => rejectButton.isEnabled()).catch(() => false);
    if (canReject) {
      await rejectButton.click();
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: path.join(screenshotDir, "commercial-approvals.png"), fullPage: true });
    }

    await captureRoute(page, "/incidents", "Incident Review Explorer", "commercial-incidents.png");
    await captureRoute(page, "/audit", "Audit Explorer", "commercial-audit.png");
    await captureRoute(page, "/commercial", "Commercial Readiness", "commercial-readiness.png");
    await captureRoute(page, "/admin", "Admin Console", "commercial-admin.png");

    await context.close();
    await browser.close();
    browser = undefined;
  } finally {
    if (browser) {
      await browser.close();
    }
    await Promise.allSettled([stopService(preview), stopService(gateway), stopService(toolRegistry)]);
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

