# Sandbox Demos

This page documents the per-demo sandbox stacks used for OpenAegis pilot pack proofs.
Each pack lives under `deployments/sandboxes/<pack>` and has two inputs:

- `compose.yaml`: the Docker Compose stack for the sandbox.
- `sandbox.json`: the manifest consumed by `tools/scripts/sandbox-proof.mjs` for config validation, startup, API probing, and workflow proof execution.

Latest validated run:

- Date: `2026-04-01`
- Report: `docs/assets/demo/sandbox-connectivity-proof.json`
- Summary: `PASS` (`5/5` sandboxes passed)

Website review screenshots:

- Sandbox Proof page: `docs/assets/screenshots/commercial-sandbox-proof.png`
- SecOps guide: `docs/assets/screenshots/commercial-project-guide-secops-runtime-guard.png`
- Revenue guide: `docs/assets/screenshots/commercial-project-guide-revenue-cycle-copilot.png`
- Supply guide: `docs/assets/screenshots/commercial-project-guide-supply-chain-resilience.png`
- Clinical guide: `docs/assets/screenshots/commercial-project-guide-clinical-quality-signal.png`
- Board guide: `docs/assets/screenshots/commercial-project-guide-board-risk-cockpit.png`

## Packs

### `secops`

Purpose: `secops-runtime-guard`

Services:

- Redpanda admin API on `http://127.0.0.1:19644`
- Prometheus on `http://127.0.0.1:19090`
- Grafana on `http://127.0.0.1:13000`
- OPA on `http://127.0.0.1:18181`

### `revenue`

Purpose: `revenue-cycle-copilot`

Services:

- Trino on `http://127.0.0.1:18080`
- Airflow on `http://127.0.0.1:18081`
- Metabase on `http://127.0.0.1:13001`

Notes:

- This pack intentionally includes both Trino and Airflow.
- The proof runner validates the compose config, probes those service APIs, applies the OpenAegis revenue policy preset, and exercises the live workflow approval path.

### `supply`

Purpose: `supply-chain-resilience`

Services:

- Trino on `http://127.0.0.1:18082`
- Airflow on `http://127.0.0.1:18083`
- MinIO on `http://127.0.0.1:19000`
- Grafana on `http://127.0.0.1:13002`

### `clinical`

Purpose: `clinical-quality-signal`

Services:

- HAPI FHIR on `http://127.0.0.1:18084`
- Metabase on `http://127.0.0.1:13003`
- OpenSearch on `http://127.0.0.1:19200`

### `board`

Purpose: `board-risk-cockpit`

Services:

- Trino on `http://127.0.0.1:18085`
- Metabase on `http://127.0.0.1:13004`
- OpenSearch on `http://127.0.0.1:19201`

## Commands

List sandboxes:

```bash
npm run sandbox:list
```

Validate compose definitions without starting containers:

```bash
npm run sandbox:config
npm run sandbox:config -- --pack revenue
```

Start or stop a single sandbox:

```bash
npm run sandbox:up -- --pack secops
npm run sandbox:down -- --pack secops
```

Run the end-to-end proof and write `docs/assets/demo/sandbox-connectivity-proof.json`:

```bash
npm run sandbox:proof
```

## Proof Report

`tools/scripts/sandbox-proof.mjs` performs these steps for each pack:

1. Runs `docker compose config --quiet` to validate the compose file.
2. Attempts `docker compose up -d --remove-orphans` for the sandbox.
3. Polls the service API probes declared in `sandbox.json`.
4. Starts the local OpenAegis API gateway proof server.
5. Calls the pack endpoints:
   - `GET /v1/projects/packs/{packId}`
   - `GET /v1/projects/packs/{packId}/experience`
   - `GET /v1/projects/packs/{packId}/settings`
   - `POST /v1/projects/packs/{packId}/policies/apply`
   - `POST /v1/projects/packs/{packId}/run`
   - `POST /v1/approvals/{approvalId}/decide`
   - `GET /v1/executions/{executionId}`
   - `GET /v1/executions/{executionId}/graph`
   - `GET /v1/audit/events`
6. Writes pass/fail details to `docs/assets/demo/sandbox-connectivity-proof.json`.

## Runtime Selection

Sandbox tooling prefers local Docker first. If local Docker daemon is unavailable on Windows, it automatically falls back to Docker running inside WSL (`Ubuntu` by default):

- Runtime source is recorded in the proof report (`docker.runtime`).
- Compose commands and service probes execute against that runtime.
- Override distro/user when needed:
  - `OPENAEGIS_WSL_DISTRO=<distro>`
  - `OPENAEGIS_WSL_USER=<linux-user>`

If neither local Docker nor WSL Docker is reachable, the proof script writes the report and exits non-zero with `docker_daemon_unavailable:...`.
