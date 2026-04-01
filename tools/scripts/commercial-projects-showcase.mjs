#!/usr/bin/env node
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAppServer as createGatewayServer } from "../../dist/services/api-gateway/src/index.js";
import { createAppServer as createToolRegistryServer } from "../../dist/services/tool-registry/src/index.js";

const ports = {
  gateway: Number(process.env.OPENAEGIS_SHOWCASE_GATEWAY_PORT ?? 3930),
  toolRegistry: Number(process.env.OPENAEGIS_SHOWCASE_TOOL_REGISTRY_PORT ?? 3931)
};

const baseUrls = {
  gateway: `http://127.0.0.1:${ports.gateway}`,
  toolRegistry: `http://127.0.0.1:${ports.toolRegistry}`
};

const call = async (baseUrl, path, method = "GET", options = {}) => {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const summarizeCheck = (id, title, passed, evidence) => ({
  id,
  title,
  passed: Boolean(passed),
  evidence
});

export const runCommercialProjectsShowcase = async () => {
  process.env.OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH = "true";
  await rm(".volumes/pilot-state.json", { force: true });
  await rm(".volumes/tool-registry-state.json", { force: true });

  const servers = {
    gateway: createGatewayServer(),
    toolRegistry: createToolRegistryServer()
  };
  servers.gateway.listen(ports.gateway);
  servers.toolRegistry.listen(ports.toolRegistry);
  await Promise.all([once(servers.gateway, "listening"), once(servers.toolRegistry, "listening")]);

  const report = {
    generatedAt: new Date().toISOString(),
    suite: "commercial-projects-showcase",
    summary: {
      totalProjects: 0,
      passedProjects: 0,
      failedProjects: 0,
      scorePercent: 0,
      status: "FAIL"
    },
    projects: [],
    endpoints: baseUrls
  };

  try {
    const clinicianLogin = await call(baseUrls.gateway, "/v1/auth/login", "POST", {
      body: { email: "clinician@starlighthealth.org" }
    });
    const securityLogin = await call(baseUrls.gateway, "/v1/auth/login", "POST", {
      body: { email: "security@starlighthealth.org" }
    });
    if (clinicianLogin.status !== 200 || securityLogin.status !== 200) {
      throw new Error("unable_to_authenticate_demo_users");
    }
    const clinicianToken = clinicianLogin.payload.accessToken;
    const securityToken = securityLogin.payload.accessToken;

    const packResponse = await call(baseUrls.gateway, "/v1/projects/packs", "GET", {
      headers: { authorization: `Bearer ${clinicianToken}` }
    });
    if (packResponse.status !== 200 || !Array.isArray(packResponse.payload.packs)) {
      throw new Error("project_pack_catalog_unavailable");
    }
    const packs = packResponse.payload.packs;

    const toolCatalog = await call(baseUrls.toolRegistry, "/v1/tools?status=published", "GET");
    const publishedToolIds = new Set(
      Array.isArray(toolCatalog.payload.manifests)
        ? toolCatalog.payload.manifests.map((manifest) => manifest.toolId)
        : []
    );

    for (const pack of packs) {
      const simulation = await call(baseUrls.gateway, `/v1/projects/packs/${pack.packId}/run`, "POST", {
        headers: { authorization: `Bearer ${clinicianToken}` },
        body: { mode: "simulation", requestFollowupEmail: true }
      });
      const simulationExecution = simulation.payload.execution ?? {};
      const simulationExecutionId = simulationExecution.executionId;

      const live = await call(baseUrls.gateway, `/v1/projects/packs/${pack.packId}/run`, "POST", {
        headers: { authorization: `Bearer ${clinicianToken}` },
        body: { mode: "live", requestFollowupEmail: true }
      });
      const liveExecution = live.payload.execution ?? {};
      const liveExecutionId = liveExecution.executionId;

      let approvalCheck = null;
      if (typeof liveExecution.approvalId === "string" && liveExecution.approvalId.length > 0) {
        const approve = await call(
          baseUrls.gateway,
          `/v1/approvals/${liveExecution.approvalId}/decide`,
          "POST",
          {
            headers: { authorization: `Bearer ${securityToken}` },
            body: { decision: "approve", reason: `Approved during showcase for ${pack.packId}` }
          }
        );
        const after = await call(baseUrls.gateway, `/v1/executions/${liveExecutionId}`, "GET", {
          headers: { authorization: `Bearer ${clinicianToken}` }
        });
        approvalCheck = {
          approvalStatus: approve.payload.status,
          executionStatusAfterApproval: after.payload.status
        };
      }

      const graph = typeof simulationExecutionId === "string"
        ? await call(baseUrls.gateway, `/v1/executions/${simulationExecutionId}/graph`, "GET", {
            headers: { authorization: `Bearer ${clinicianToken}` }
          })
        : { status: 404, payload: {} };
      const graphStages = graph.payload.graphExecution?.steps?.map((step) => step.stage) ?? [];

      const connectorCoverage = Array.isArray(pack.connectors)
        ? pack.connectors.every((connector) => publishedToolIds.has(connector.toolId))
        : false;

      const checks = [
        summarizeCheck("connectors_registered", "All required connectors are in the published registry", connectorCoverage, {
          requiredConnectorToolIds: Array.isArray(pack.connectors) ? pack.connectors.map((connector) => connector.toolId) : [],
          publishedToolCount: publishedToolIds.size
        }),
        summarizeCheck("simulation_run", "Simulation run executes and returns auditable execution payload", simulation.status === 201, {
          status: simulation.status,
          executionId: simulationExecutionId,
          executionStatus: simulationExecution.status,
          evidenceId: simulationExecution.evidenceId
        }),
        summarizeCheck("live_governance_path", "Live run enforces governance path and can proceed with approval", live.status === 201, {
          status: live.status,
          executionId: liveExecutionId,
          executionStatus: liveExecution.status,
          approvalId: liveExecution.approvalId ?? null,
          ...(approvalCheck ? { approvalCheck } : {})
        }),
        summarizeCheck("deterministic_graph", "Graph stages are available for replay and verification", graph.status === 200, {
          status: graph.status,
          graphExecutionId: graph.payload.graphExecution?.graphExecutionId,
          stages: graphStages
        }),
        summarizeCheck(
          "evidence_presence",
          "Simulation and live runs contain evidence IDs",
          typeof simulationExecution.evidenceId === "string" && typeof liveExecution.evidenceId === "string",
          {
            simulationEvidenceId: simulationExecution.evidenceId,
            liveEvidenceId: liveExecution.evidenceId
          }
        )
      ];

      const passed = checks.every((check) => check.passed);
      report.projects.push({
        packId: pack.packId,
        name: pack.name,
        workflowId: pack.workflowId,
        passed,
        checks
      });
    }

    report.summary.totalProjects = report.projects.length;
    report.summary.passedProjects = report.projects.filter((project) => project.passed).length;
    report.summary.failedProjects = report.summary.totalProjects - report.summary.passedProjects;
    report.summary.scorePercent = report.summary.totalProjects === 0
      ? 0
      : Math.round((report.summary.passedProjects / report.summary.totalProjects) * 100);
    report.summary.status = report.summary.failedProjects === 0 ? "PASS" : "FAIL";
  } finally {
    servers.gateway.close();
    servers.toolRegistry.close();
    await Promise.all([once(servers.gateway, "close"), once(servers.toolRegistry, "close")]);
  }

  await mkdir("docs/assets/demo", { recursive: true });
  await writeFile(
    "docs/assets/demo/commercial-projects-showcase-report.json",
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  return report;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommercialProjectsShowcase()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
