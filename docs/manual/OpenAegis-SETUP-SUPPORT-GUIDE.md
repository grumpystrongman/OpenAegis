# OpenAegis Setup and Support Guide

## 1. Prerequisites

- Node.js 22+
- npm 10+
- Playwright dependencies (for screenshot automation)
- Docker optional

## 2. Install and Validate

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run smoke:pilot
```

## 3. Run Local Demo

Terminal A:

```bash
OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH=true
PORT=4300 node tools/scripts/run-gateway.mjs
```

Terminal B:

```bash
VITE_API_URL=http://127.0.0.1:4300 npm run --workspace @openaegis/admin-console dev -- --host 127.0.0.1 --port 4273
```

Open `http://127.0.0.1:4273`.

## 4. Guided UI Setup Steps

1. Open Setup Center (`/setup`) and connect demo sessions.
2. Open Integration Hub (`/integrations`), load example config, and verify one integration.
3. Open Identity & Access (`/identity`) and confirm role/assurance assignments.
4. Open Security Console (`/security`) for policy changes.
5. Change one policy control.
6. Click Preview impact.
7. Click Explain impact.
8. Click Ask copilot.
9. Apply policy.

Expected behavior:

- warnings appear for risky controls
- blocking downgrades require break-glass fields
- policy profile version increases after successful save

## 5. Optional Local LLM Copilot Backend

Set `OPENAEGIS_LOCAL_LLM_ENDPOINT` before starting gateway.

Example (PowerShell):

```powershell
$env:OPENAEGIS_LOCAL_LLM_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions"
PORT=4300 node tools/scripts/run-gateway.mjs
```

If not set, copilot uses built-in fallback logic.

## 6. Optional OIDC Introspection Hardening

For enterprise SSO-style token validation at the gateway:

```powershell
$env:OPENAEGIS_AUTH_INTROSPECTION_URL = "http://127.0.0.1:3001/v1/auth/introspect"
$env:OPENAEGIS_REQUIRE_INTROSPECTION = "true"
$env:OPENAEGIS_AUTH_INTROSPECTOR_ACTOR_ID = "service-gateway"
$env:OPENAEGIS_AUTH_INTROSPECTOR_TENANT_ID = "tenant-platform"
PORT=4300 node tools/scripts/run-gateway.mjs
```

When enabled:

- non-demo bearer tokens are validated via introspection
- tenant claims are enforced on write paths
- cross-tenant writes return `tenant_scope_mismatch`

Secure default:

- if `OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH` is not set to `true`, `/v1/auth/login` is disabled and demo tokens are rejected.
- if `OPENAEGIS_ENABLE_INSECURE_CUSTOM_TOKEN_MINT` is not set to `true`, `auth-service` denies arbitrary subject/tenant/role token mint requests.
## 7. Generate Demo Artifacts

```bash
node tools/scripts/pilot-demo.mjs
npm run screenshots:commercial
```

Artifacts:

- `docs/assets/demo/pilot-demo-output.json`
- `docs/assets/demo/commercial-proof-report.json`
- `docs/assets/screenshots/commercial-*.png`

## 8. Common Issues

### Browser shows `Failed to fetch`

- confirm gateway is running
- confirm `VITE_API_URL` points to gateway
- confirm no port conflict

### Policy save fails with break-glass error

- check ticket ID is set
- check justification length is at least 20 characters
- check at least two approver IDs are provided

### Port conflict (`EADDRINUSE`)

- change UI/API ports
- stop conflicting process

### `git push` fails

- confirm remote:

```bash
git remote -v
```

- add missing remote if needed:

```bash
git remote add origin <repository-url>
```

## 9. Support Escalation Template

Include:

- OS and Node version
- command executed
- full error output
- expected vs actual behavior
- screenshot path or log snippet
