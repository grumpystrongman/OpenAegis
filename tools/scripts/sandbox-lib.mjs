#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..", "..");
export const sandboxesRoot = path.join(repoRoot, "deployments", "sandboxes");
export const proofReportPath = path.join(repoRoot, "docs", "assets", "demo", "sandbox-connectivity-proof.json");
const defaultWslDistro = process.env.OPENAEGIS_WSL_DISTRO ?? "Ubuntu";
const defaultWslUser = process.env.OPENAEGIS_WSL_USER ?? process.env.USERNAME ?? "grump";

let dockerRuntimeCache = null;

const summarizeOutput = (value, limit = 1200) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
};

export const formatError = (error) => {
  if (!error) return "unknown_error";
  if (error instanceof Error) return error.message;
  return String(error);
};

export const loadSandboxCatalog = async () => {
  const entries = await readdir(sandboxesRoot, { withFileTypes: true });
  const sandboxes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const manifestPath = path.join(sandboxesRoot, entry.name, "sandbox.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      sandboxes.push({
        ...manifest,
        directory: path.join(sandboxesRoot, entry.name),
        manifestPath,
        composeFileAbsolute: path.join(repoRoot, manifest.composeFile)
      });
    } catch {
      // Ignore directories without a sandbox manifest.
    }
  }
  return sandboxes.sort((left, right) => left.id.localeCompare(right.id));
};

export const parseArgs = (argv) => {
  const args = { command: "list", pack: null, all: false };
  const tokens = argv.slice(2);
  if (tokens.length > 0 && !tokens[0].startsWith("--")) {
    args.command = tokens.shift();
  }
  while (tokens.length > 0) {
    const token = tokens.shift();
    if (token === "--pack") {
      args.pack = tokens.shift() ?? null;
      continue;
    }
    if (token?.startsWith("--pack=")) {
      args.pack = token.split("=", 2)[1] ?? null;
      continue;
    }
    if (token === "--all") {
      args.all = true;
      continue;
    }
  }
  return args;
};

const shQuote = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

const toWslPath = (targetPath) => {
  const normalized = String(targetPath).replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return normalized;
  const [, drive, rest] = driveMatch;
  return `/mnt/${drive.toLowerCase()}/${rest}`;
};

export const selectSandboxes = (sandboxes, options = {}) => {
  if (options.all || !options.pack) return sandboxes;
  const selected = sandboxes.find((sandbox) => sandbox.id === options.pack || sandbox.packId === options.pack);
  if (!selected) {
    throw new Error(`sandbox_not_found:${options.pack}`);
  }
  return [selected];
};

export const runCommand = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, error });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });

const composeArgs = (sandbox, runtime, extraArgs = []) => [
  "compose",
  "-f",
  runtime.kind === "wsl" ? toWslPath(sandbox.composeFileAbsolute) : sandbox.composeFileAbsolute,
  "-p",
  sandbox.projectName,
  ...extraArgs
];

const parseDockerVersionOutput = (value) => {
  try {
    return value.trim() ? JSON.parse(value.trim()) : null;
  } catch {
    return null;
  }
};

export const detectDockerRuntime = async () => {
  if (dockerRuntimeCache) return dockerRuntimeCache;

  const native = await runCommand("docker", ["version", "--format", "{{json .}}"]);
  const nativeCombined = [native.stdout, native.stderr].filter(Boolean).join("\n").trim();
  if (native.code === 0) {
    const details = parseDockerVersionOutput(native.stdout);
    if (details?.Server) {
      dockerRuntimeCache = {
        kind: "native",
        cliAvailable: true,
        daemonAvailable: true,
        details,
        error: null
      };
      return dockerRuntimeCache;
    }
  }

  if (process.platform === "win32") {
    const wslCli = await runCommand("wsl", ["-d", defaultWslDistro, "--", "docker", "--version"]);
    const wslCliOk = wslCli.code === 0;
    const wslVersion = await runCommand("wsl", [
      "-d",
      defaultWslDistro,
      "--",
      "bash",
      "-lc",
      "docker version --format '{{json .}}'"
    ]);

    if (wslVersion.code === 0) {
      const details = parseDockerVersionOutput(wslVersion.stdout);
      if (details?.Server) {
        dockerRuntimeCache = {
          kind: "wsl",
          distro: defaultWslDistro,
          cliAvailable: true,
          daemonAvailable: true,
          details,
          error: null
        };
        return dockerRuntimeCache;
      }
    }

    dockerRuntimeCache = {
      kind: "none",
      cliAvailable: wslCliOk || native.code !== -1,
      daemonAvailable: false,
      details: parseDockerVersionOutput(native.stdout) ?? parseDockerVersionOutput(wslVersion.stdout),
      error: summarizeOutput([nativeCombined, wslVersion.stderr].filter(Boolean).join("\n")) || "docker_daemon_unavailable"
    };
    return dockerRuntimeCache;
  }

  dockerRuntimeCache = {
    kind: "none",
    cliAvailable: native.code !== -1,
    daemonAvailable: false,
    details: parseDockerVersionOutput(native.stdout),
    error: summarizeOutput(nativeCombined) || "docker_daemon_unavailable"
  };
  return dockerRuntimeCache;
};

const runDocker = async (dockerArgs, options = {}) => {
  const runtime = options.runtime ?? (await detectDockerRuntime());
  if (runtime.kind === "wsl") {
    const workdir = toWslPath(options.cwd ?? repoRoot);
    const wslHome = `/home/${defaultWslUser}`;
    const script = `export HOME=${shQuote(wslHome)} && cd ${shQuote(workdir)} && docker ${dockerArgs
      .map(shQuote)
      .join(" ")}`;
    const result = await runCommand("wsl", ["-d", runtime.distro, "--", "bash", "-lc", script], {
      env: { HOME: wslHome }
    });
    return { ...result, runtime };
  }

  if (runtime.kind === "native") {
    const result = await runCommand("docker", dockerArgs, options);
    return { ...result, runtime };
  }

  return {
    code: -1,
    stdout: "",
    stderr: runtime.error ?? "docker_daemon_unavailable",
    runtime
  };
};

export const dockerVersion = async () => {
  const runtime = await detectDockerRuntime();
  return {
    cliAvailable: runtime.cliAvailable,
    daemonAvailable: runtime.daemonAvailable,
    details: runtime.details,
    runtime: runtime.kind === "wsl" ? `wsl:${runtime.distro}` : runtime.kind,
    error: runtime.error
  };
};

export const validateCompose = async (sandbox) => {
  const startedAt = Date.now();
  const runtime = await detectDockerRuntime();
  const args = composeArgs(sandbox, runtime, ["config", "--quiet"]);
  const result = await runDocker(args, { runtime });
  return {
    command: `${runtime.kind === "wsl" ? `wsl:${runtime.distro} docker` : "docker"} ${args.join(" ")}`,
    ok: result.code === 0,
    exitCode: result.code,
    elapsedMs: Date.now() - startedAt,
    stdout: summarizeOutput(result.stdout),
    stderr: summarizeOutput(result.stderr)
  };
};

export const composeUp = async (sandbox) => {
  const startedAt = Date.now();
  const runtime = await detectDockerRuntime();
  const args = composeArgs(sandbox, runtime, ["up", "-d", "--remove-orphans"]);
  const result = await runDocker(args, { runtime });
  return {
    command: `${runtime.kind === "wsl" ? `wsl:${runtime.distro} docker` : "docker"} ${args.join(" ")}`,
    ok: result.code === 0,
    exitCode: result.code,
    elapsedMs: Date.now() - startedAt,
    stdout: summarizeOutput(result.stdout),
    stderr: summarizeOutput(result.stderr)
  };
};

export const composeDown = async (sandbox) => {
  const startedAt = Date.now();
  const runtime = await detectDockerRuntime();
  const args = composeArgs(sandbox, runtime, ["down", "-v", "--remove-orphans"]);
  const result = await runDocker(args, { runtime });
  return {
    command: `${runtime.kind === "wsl" ? `wsl:${runtime.distro} docker` : "docker"} ${args.join(" ")}`,
    ok: result.code === 0,
    exitCode: result.code,
    elapsedMs: Date.now() - startedAt,
    stdout: summarizeOutput(result.stdout),
    stderr: summarizeOutput(result.stderr)
  };
};

export const composePs = async (sandbox) => {
  const runtime = await detectDockerRuntime();
  const result = await runDocker(composeArgs(sandbox, runtime, ["ps", "--all"]), { runtime });
  return {
    ok: result.code === 0,
    exitCode: result.code,
    stdout: summarizeOutput(result.stdout),
    stderr: summarizeOutput(result.stderr)
  };
};

const fetchWithTimeout = async (url, timeoutMs) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.status,
    bodyPreview: summarizeOutput(text, 600)
  };
};

const fetchViaWsl = async (url, timeoutMs, runtime) => {
  const timeoutSeconds = Math.max(2, Math.ceil(timeoutMs / 1000));
  const wslHome = `/home/${defaultWslUser}`;
  const script = [
    `export HOME=${shQuote(wslHome)}`,
    `curl -m ${timeoutSeconds} -sS -o - -w '\\n__STATUS__:%{http_code}' ${shQuote(url)}`
  ].join(" && ");
  const result = await runCommand("wsl", ["-d", runtime.distro, "--", "bash", "-lc", script], {
    env: { HOME: wslHome }
  });
  if (result.code !== 0 && !result.stdout.includes("__STATUS__:")) {
    throw new Error(result.stderr.trim() || "wsl_probe_failed");
  }

  const marker = "__STATUS__:";
  const markerIndex = result.stdout.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error("wsl_probe_status_missing");
  }
  const body = result.stdout.slice(0, markerIndex).trim();
  const statusText = result.stdout.slice(markerIndex + marker.length).trim().split(/\s+/)[0];
  const status = Number.parseInt(statusText, 10);
  if (Number.isNaN(status)) {
    throw new Error(`wsl_probe_status_invalid:${statusText}`);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    bodyPreview: summarizeOutput(body, 600)
  };
};

export const waitForHttpProbe = async (probe, options = {}) => {
  const timeoutMs = Number(probe.timeoutMs ?? 180000);
  const intervalMs = Number(probe.intervalMs ?? 3000);
  const expectedStatus = Number(probe.expectedStatus ?? 200);
  const runtime = options.runtime ?? null;
  const deadline = Date.now() + timeoutMs;
  let lastError = "probe_never_started";
  let lastStatus = null;
  let lastBodyPreview = "";
  let lastUrl = probe.urls?.[0] ?? probe.url ?? "";

  while (Date.now() < deadline) {
    for (const candidate of probe.urls ?? [probe.url]) {
      lastUrl = candidate;
      try {
        const result =
          runtime?.kind === "wsl"
            ? await fetchViaWsl(candidate, Math.min(intervalMs, 5000), runtime)
            : await fetchWithTimeout(candidate, Math.min(intervalMs, 5000));
        lastStatus = result.status;
        lastBodyPreview = result.bodyPreview;
        if (result.status === expectedStatus) {
          return {
            ok: true,
            url: candidate,
            httpStatus: result.status,
            bodyPreview: result.bodyPreview,
            error: null
          };
        }
        lastError = `unexpected_status:${result.status}`;
      } catch (error) {
        lastError = formatError(error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    ok: false,
    url: lastUrl,
    httpStatus: lastStatus,
    bodyPreview: lastBodyPreview,
    error: lastError
  };
};

export const writeJsonReport = async (filePath, payload) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
