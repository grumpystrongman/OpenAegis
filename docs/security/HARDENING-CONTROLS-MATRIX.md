# Hardening Controls Matrix

This matrix maps the required security controls to the services and endpoints currently present in the repository.

The point of the matrix is traceability:

- every control has an owner
- every control has a service or endpoint
- every control has a validation path

## Matrix

| Control | Implemented service or endpoint | What it does | Validation |
| --- | --- | --- | --- |
| SSO and session assurance | `auth-service` - `POST /v1/auth/token`, `POST /v1/auth/introspect`, `POST /v1/auth/revoke` | Issues, validates, and revokes signed sessions with assurance checks | Token/introspection/revocation flow returns deterministic status |
| Gateway authn and tenant binding | `api-gateway` - auth-service introspection (`OPENAEGIS_AUTH_INTROSPECTION_URL`) + optional insecure demo auth toggle (`OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH`) | Rejects unauthenticated requests, enforces tenant scope from token claims, and disables demo auth unless explicitly enabled | Requests without a valid token are denied; cross-tenant writes fail with `tenant_scope_mismatch`; demo login returns `demo_auth_disabled` by default |
| Tenant isolation | `tenant-service` - `PATCH /v1/tenants/{id}/isolation`, `GET /v1/tenants/{id}/policy` | Enforces tenant boundary validation and posture state | Cross-tenant access is denied without platform admin role |
| Policy enforcement outside the model | `policy-service` - `POST /v1/policies/evaluate` | Evaluates allow, require-approval, or deny decisions | Policy result is produced before execution continues |
| Policy pre-checks in the gateway | `api-gateway` - `POST /v1/policy/evaluate` | Allows fast pre-checks at ingress | Gateway rejects unsafe requests before workflow work begins |
| Approval workflow and dual control | `approval-service` + `api-gateway` - `POST /v1/approvals`, `POST /v1/approvals/{id}/decide`, `GET /v1/approvals` | Creates and resolves human approvals with role and tenant checks at ingress | Live workflows pause until approval is granted; non-approvers and cross-tenant decision attempts are denied |
| Workflow determinism and checkpoints | `workflow-orchestrator` - `POST /v1/executions`, `POST /v1/executions/{id}/checkpoints`, `GET /v1/executions/{id}` | Runs deterministic state transitions | Execution checkpoints and transitions remain replayable |
| Vendor-neutral model routing | `model-broker` - `POST /v1/model-broker/routes/evaluate`, `GET /v1/model-broker/providers/capabilities` | Selects provider and model by policy | Route evaluation returns selected provider and fallback options |
| Zero-retention enforcement | `model-broker` and `api-gateway` route previews | Restricts sensitive requests to providers that support the required posture | EPHI routes must stay on zero-retention paths |
| Sandbox tool execution | `tool-execution-service` - `POST /v1/tool-calls`, `GET /v1/tool-calls`, `GET /v1/tool-calls/{toolCallId}` | Runs tool calls under guard rails with tenant+role binding and replay safety | Guard rejects unauthorized action/network profile/approval state, cross-tenant lookup is denied, and live execute without idempotency key is blocked |
| Signed tool manifests | `tool-registry` - `POST /v1/tools`, `POST /v1/tools/{id}/publish`, `GET /v1/tools/{id}` | Registers connector and tool definitions | Published manifests are scope-validated and actor-controlled |
| Connector trust tiers | `tool-registry` - `GET /v1/tools?status=published&trustTier=tier-1&capability=fhir` | Separates high-trust and lower-trust connectors | Tiered connector queries work as expected |
| PHI/PII/DLP classification | `classification-service` - `POST /v1/classification/classify`, `GET /v1/classification/events` | Scans sensitive content and records decisions | DLP/classification rules are enforced before sensitive content leaves the boundary |
| Immutable audit ledger | `audit-ledger` - `POST /v1/audit/evidence`, `GET /v1/audit/evidence/{id}`, `GET /v1/audit/verify-chain` | Stores append-only evidence and verifies chain integrity | Evidence IDs are retrievable and hash-chain verification passes |
| Short-lived secrets leasing | `secrets-broker` - `POST /v1/secrets/lease`, `POST /v1/secrets/revoke`, `GET /v1/secrets/leases` | Leases credentials for a limited time | Leases are short-lived and revocable |
| OTel telemetry and SLO analytics | `observability-service` - `POST /v1/observability/envelopes`, `GET /v1/observability/traces`, `GET /v1/observability/metrics/health` | Collects traces, logs, and metrics | Telemetry can be queried without exposing cross-tenant data |
| Emergency halt and circuit breaking | `kill-switch-service` - `POST /v1/kill-switch/trigger`, `POST /v1/kill-switch/release`, `GET /v1/kill-switch/status` | Stops scoped or global activity quickly | Scoped trigger/release actions are role-gated and auditable |
| Gateway evidence and commercial proof | `api-gateway` - `GET /v1/commercial/proof`, `GET /v1/commercial/readiness`, `GET /v1/commercial/claims` | Exposes live proof and readiness snapshots | Proof report regenerates from the current commit |

## Control Notes

### Identity and access

`auth-service` and `api-gateway` are the front door for identity checks. The production expectation is SSO federation with short-lived sessions, step-up for sensitive actions, and server-side enforcement of tenant binding. In hardened mode, enable gateway introspection by setting:

- `OPENAEGIS_AUTH_INTROSPECTION_URL`
- `OPENAEGIS_REQUIRE_INTROSPECTION=true`
- optional: `OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID`, `OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID`, `OPENAEGIS_AUTH_INTROSPECTION_TIMEOUT_MS`
- secure default: keep `OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH` unset in non-demo environments

### Policy and approval

Policy must never depend on the model. The model can propose content; `policy-service` and `approval-service` decide whether the content can move forward.

### Tool execution

`tool-registry` and `tool-execution-service` form the tool trust boundary. Tool definitions are signed, published by actor, and executed with runtime guards.

### Data sensitivity

`classification-service` is the control point for PHI, PII, and other sensitive data. The expected behavior is scan before egress, redact when needed, and deny when the policy requires it.

### Evidence

`audit-ledger` is the compliance boundary. A release is only defensible if major actions produce evidence IDs that can be retrieved and replayed.

### Routing

`model-broker` must remain the only model-selection path. Provider choice belongs behind the broker so the business logic never hard-codes a vendor.

## Validation Pattern

The security team should validate the matrix by checking:

1. unauthenticated requests are rejected
2. sensitive workflows require approval
3. tool calls are blocked when guard conditions fail
4. audit events are evidence-linked
5. sensitive model routing respects zero-retention
6. the proof report regenerates from the current branch

If any one of those checks fails, the control is not ready for production use.
