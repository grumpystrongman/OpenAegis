# SRE Runbook

This runbook covers day-2 operations for the OpenAegis pilot and the path to a production deployment.

It is written for operators who need to keep the platform available, safe, and auditable under load.

## Service Overview

The current platform surfaces these operational services:

- `api-gateway`
- `auth-service`
- `tenant-service`
- `policy-service`
- `approval-service`
- `workflow-orchestrator`
- `model-broker`
- `tool-registry`
- `tool-execution-service`
- `classification-service`
- `audit-ledger`
- `secrets-broker`
- `observability-service`
- `kill-switch-service`

## SLOs

These are the minimum operational targets for a production deployment.

| SLO | Target | Measurement |
| --- | --- | --- |
| API availability | 99.9% monthly | `api-gateway` `/healthz` and authenticated read paths |
| Policy evaluation success | 100% fail-closed behavior | All policy decisions return deterministically |
| Audit write durability | 100% | No dropped audit events or missing evidence IDs |
| Approval decision durability | 100% | Every approval request has a persisted record |
| Tool execution safety | 100% guard enforcement | No tool call bypasses runtime guard checks |
| EPHI routing compliance | 100% | Sensitive requests only route to allowed zero-retention paths |
| Evidence replayability | 100% | Audit and execution records can be replayed from stored evidence |

## Alert Thresholds

Page the on-call engineer when any of the following occurs:

- `api-gateway` health check fails for 2 consecutive probes
- 5xx rate exceeds 1% for 5 minutes
- `policy-service` returns an error or times out on a fail-closed decision path
- `approval-service` receives a decision failure or duplicate replay event
- `audit-ledger` write failure occurs even once
- `tool-execution-service` rejects due to guard failure on a known-good path
- `model-broker` routes a sensitive request to a disallowed provider
- `kill-switch-service` activates unexpectedly
- `docs/assets/demo/commercial-proof-report.json` fails to regenerate in CI

For a pilot deployment, treat any audit or policy failure as high severity.

## On-Call Playbook

### 1. Triage the blast radius

Determine whether the issue affects:

- authentication
- policy evaluation
- approval gating
- tool execution
- model routing
- audit logging
- the UI only

Start with the gateway and then trace downstream.

### 2. Stabilize the system

If risk is unclear:

- activate the kill switch for the affected scope
- stop live workflow execution
- preserve audit data and logs
- do not delete evidence

### 3. Confirm the failure mode

Use the current evidence-first checks:

```bash
npm run typecheck
npm run build
npm run test
npm run smoke:pilot
npm run proof:commercial
npm run load:commercial
npm run chaos:commercial
npm run readiness:gate
```

If the incident is production-facing, run the most specific check first:

- auth issue: verify login and token refresh
- policy issue: verify `/v1/policy/evaluate`
- approval issue: verify `/v1/approvals`
- tool issue: verify `/v1/tool-calls`
- audit issue: verify `/v1/audit/events`

### 4. Contain

Containment actions may include:

- disabling live workflow execution
- routing to simulation mode only
- denying outbound provider calls
- revoking short-lived credentials
- pausing connector publication

### 5. Recover

Recover in this order:

1. Restore the failed dependency.
2. Re-run the failing command or health probe.
3. Re-run the smoke path.
4. Re-run the load and chaos drills.
5. Re-run the commercial proof harness.
6. Run the readiness gate and confirm score >= 98.
7. Confirm the evidence bundle regenerates cleanly.

### 6. Post-incident review

After recovery:

- document root cause
- capture command output and timestamps
- verify evidence IDs remain intact
- add a regression test if the issue was code-related
- update the release gate if the incident exposed a missing check

## Backup and Restore Checks

### Backup expectations

Production should back up:

- Postgres metadata
- object storage evidence
- workflow and approval records
- policy bundles
- tool registry state

### Restore expectations

At minimum, verify:

- a backup can be restored into an isolated environment
- the restored system can read prior audit evidence
- the restored system can run a simulation path
- the restored system can re-run the commercial proof harness

### DR targets

Recommended targets for a regulated enterprise deployment:

- RPO: 24 hours or less
- RTO: 4 hours or less

These targets should be tightened for higher-risk hospital deployments.

### DR drill cadence

- daily backup verification
- weekly restore spot check
- monthly disaster recovery drill
- quarterly evidence replay drill

## Incident Categories

Use these categories for routing and escalation:

- authentication failure
- tenant isolation failure
- policy evaluation failure
- approval workflow failure
- tool execution guard failure
- model routing violation
- audit ledger failure
- backup or restore failure
- kill switch activation

## Operator Checks Before Business Hours

Before a production day begins, confirm:

- health checks are green
- the latest backup completed successfully
- the kill switch is not active
- the approval inbox is functioning
- the commercial proof report still matches the current release

## Operator Checks After Change Window

After any deployment or configuration change:

1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Run `npm run test`.
4. Run `npm run smoke:pilot`.
5. Run `npm run proof:commercial`.
6. Run `npm run load:commercial`.
7. Run `npm run chaos:commercial`.
8. Run `npm run readiness:gate`.
9. Verify readiness score remains at or above 98.

If any step fails, revert the change or roll forward a fix before declaring success.
