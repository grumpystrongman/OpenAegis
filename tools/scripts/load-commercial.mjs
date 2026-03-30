#!/usr/bin/env node
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createAppServer } from "../../backend/services/api-gateway/src/index.ts";

const port = Number(process.env.OPENAEGIS_LOAD_TEST_PORT ?? 3930);
const baseUrl = `http://127.0.0.1:${port}`;

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const runWorkers = async ({ totalRequests, concurrency, runRequest }) => {
  const durations = [];
  const statuses = [];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const requestIndex = cursor;
      cursor += 1;
      if (requestIndex >= totalRequests) break;

      const startedAt = performance.now();
      const status = await runRequest(requestIndex);
      const elapsedMs = performance.now() - startedAt;
      durations.push(elapsedMs);
      statuses.push(status);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { durations, statuses };
};

const evaluateScore = (metrics, thresholds) => {
  const errorScore =
    metrics.errorRate <= thresholds.maxErrorRate
      ? Math.max(0, Math.round(100 - (metrics.errorRate / thresholds.maxErrorRate) * 20))
      : 0;

  const latencyScore =
    metrics.p95Ms <= thresholds.maxP95Ms
      ? Math.max(0, Math.round(100 - (metrics.p95Ms / thresholds.maxP95Ms) * 15))
      : 0;

  const throughputScore =
    metrics.throughputRps >= thresholds.minThroughputRps
      ? Math.min(100, Math.round((metrics.throughputRps / thresholds.minThroughputRps) * 100))
      : 0;

  const score = Math.round(errorScore * 0.4 + latencyScore * 0.35 + throughputScore * 0.25);
  const pass =
    metrics.errorRate <= thresholds.maxErrorRate &&
    metrics.p95Ms <= thresholds.maxP95Ms &&
    metrics.throughputRps >= thresholds.minThroughputRps &&
    score >= 98;

  return {
    score,
    pass,
    components: {
      errorScore,
      latencyScore,
      throughputScore
    }
  };
};

export const runCommercialLoadTest = async () => {
  await rm(".volumes/pilot-state.json", { force: true });

  const server = createAppServer();
  server.listen(port);
  await once(server, "listening");

  try {
    const loginResponse = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "clinician@starlighthealth.org" })
    });
    const loginBody = await loginResponse.json();
    if (!loginResponse.ok || typeof loginBody.accessToken !== "string") {
      throw new Error("load_test_login_failed");
    }

    const token = loginBody.accessToken;
    const headers = {
      authorization: `Bearer ${token}`
    };

    await runWorkers({
      totalRequests: 25,
      concurrency: 5,
      runRequest: async () => {
        const response = await fetch(`${baseUrl}/v1/commercial/readiness`, { headers });
        return response.status;
      }
    });

    const totalRequests = Number(process.env.OPENAEGIS_LOAD_TEST_REQUESTS ?? 180);
    const concurrency = Number(process.env.OPENAEGIS_LOAD_TEST_CONCURRENCY ?? 18);
    const startedAt = performance.now();

    const { durations, statuses } = await runWorkers({
      totalRequests,
      concurrency,
      runRequest: async () => {
        const response = await fetch(`${baseUrl}/v1/commercial/readiness`, { headers });
        return response.status;
      }
    });

    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const successes = statuses.filter((status) => status >= 200 && status < 300).length;
    const failures = statuses.length - successes;
    const thresholds = {
      maxErrorRate: Number(process.env.OPENAEGIS_LOAD_TEST_MAX_ERROR_RATE ?? 0.02),
      maxP95Ms: Number(process.env.OPENAEGIS_LOAD_TEST_MAX_P95_MS ?? 450),
      minThroughputRps: Number(process.env.OPENAEGIS_LOAD_TEST_MIN_RPS ?? 40)
    };

    const metrics = {
      requests: totalRequests,
      concurrency,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      successes,
      failures,
      errorRate: Number((failures / Math.max(1, totalRequests)).toFixed(6)),
      throughputRps: Number((totalRequests / Math.max(elapsedSeconds, 0.001)).toFixed(2)),
      p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
      p99Ms: Number(percentile(durations, 0.99).toFixed(2))
    };

    const scoring = evaluateScore(metrics, thresholds);
    const report = {
      generatedAt: new Date().toISOString(),
      suite: "commercial-load-test",
      target: baseUrl,
      thresholds,
      metrics,
      scorePercent: scoring.score,
      status: scoring.pass ? "PASS" : "FAIL",
      components: scoring.components
    };

    await mkdir("docs/assets/demo", { recursive: true });
    await writeFile("docs/assets/demo/load-test-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    server.close();
    await once(server, "close");
  }
};

if ((process.argv[1] ?? "").replace(/\\/g, "/").endsWith("/tools/scripts/load-commercial.mjs")) {
  runCommercialLoadTest()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "PASS") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
