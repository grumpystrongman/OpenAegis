# OpenAegis API Contracts (Pilot)

This document captures the concrete API contracts used by the current pilot and Policy Studio.

## Authentication

### `POST /v1/auth/login`

Request:

```json
{
  "email": "security@starlighthealth.org"
}
```

Response includes `accessToken` used as `Authorization: Bearer <token>`.

## Policy Studio APIs

### `GET /v1/policies/profile`

Returns active policy profile and validation snapshot.

### `POST /v1/policies/profile/preview`

Preview policy impact before saving.

Request:

```json
{
  "profileName": "Hospital Safe Baseline",
  "controls": {
    "requireApprovalForHighRiskLive": false,
    "maxToolCallsPerExecution": 10
  }
}
```

Response includes:

- `profile`
- `validation.valid`
- `validation.issues`
- `validation.simulation`

### `POST /v1/policies/profile/copilot`

Get plain-language review and safer suggestions.

Request:

```json
{
  "operatorGoal": "Keep this safe and easy for new staff",
  "controls": {
    "requireApprovalForHighRiskLive": false,
    "maxToolCallsPerExecution": 18
  }
}
```

Response includes:

- `source` (`local-llm` or `builtin`)
- `summary`
- `riskNarrative`
- `hints[]`
- `suggestedControls`
- `confidence`

### `POST /v1/policies/profile/save`

Apply policy profile changes.

Normal request:

```json
{
  "changeSummary": "Tune approvals for pilot operations",
  "controls": {
    "requireApprovalForHighRiskLive": true,
    "maxToolCallsPerExecution": 9
  }
}
```

Blocking-risk downgrade request requires break-glass:

```json
{
  "changeSummary": "Emergency override",
  "controls": {
    "enforceSecretDeny": false
  },
  "breakGlass": {
    "ticketId": "BG-2026-001",
    "justification": "Emergency continuity under compliance supervision.",
    "approverIds": ["security-lead-1", "compliance-lead-2"]
  }
}
```

Error behavior:

- `403`: insufficient role for policy change
- `422`: break-glass required for blocking changes

## Workflow APIs

### `POST /v1/executions`

Starts simulation or live execution.

### `GET /v1/executions/{executionId}`

Returns execution record with policy decision, approvals, and evidence IDs.

### `GET /v1/executions/{executionId}/graph`

Returns deterministic planner/executor/reviewer graph execution details.

## Project Pack APIs

### `GET /v1/projects/packs`

Returns the five commercial project packs used for demos and pilots.

### `GET /v1/projects/packs/{packId}`

Returns full details for one project pack, including connectors, controls, and KPI targets.

### `GET /v1/projects/packs/{packId}/experience`

Returns seeded demo tables, policy rules, live-evaluated policy scenarios, trust checks, and a step-by-step walkthrough.

### `POST /v1/projects/packs/{packId}/run`

Runs the selected project in simulation or live mode.

Request:

```json
{
  "mode": "simulation",
  "requestFollowupEmail": true
}
```

Response includes:

- `pack`
- `execution`

### `POST /v1/projects/packs/{packId}/policies/apply`

Applies the secure baseline policy preset for the project pack. Requires `security_admin` or `platform_admin`.

Response includes:

- `pack`
- `appliedPreset`
- `result.profile`
- `result.validation`

## Approval APIs

### `GET /v1/approvals`

List current approval requests.

### `POST /v1/approvals/{approvalId}/decide`

Approve or reject a pending request.

## Audit and Incident APIs

- `GET /v1/audit/events`
- `GET /v1/audit/evidence/{evidenceId}`
- `GET /v1/incidents`
- `GET /v1/incidents/{incidentId}`

## Commercial Proof APIs

- `GET /v1/commercial/claims`
- `GET /v1/commercial/proof`
- `GET /v1/commercial/readiness`
