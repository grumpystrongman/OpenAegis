# Smoke Test and Pilot Test Report

## Commands Executed

```bash
npm run typecheck
npm run test
npm run build
npm run test:commercial
npm run smoke:pilot
npm run proof:commercial
npm run screenshots:commercial
node tools/scripts/pilot-demo.mjs
```

## Smoke Test Result

- Status: PASS
- Script: `tools/scripts/smoke-pilot.mjs`
- Last verified: `2026-03-30`
- Validation:
  - demo login
  - live workflow creation
  - approval decision
  - post-approval completion
  - audit event availability

## Pilot Test Result

- Status: PASS
- Script: `tools/scripts/pilot-demo.mjs`
- Artifact: `docs/assets/demo/pilot-demo-output.json`

## Commercial Proof Result

- Status: PASS
- Script: `tools/scripts/commercial-proof.mjs`
- Test harness: `tests/commercial/commercial-proof.test.mjs`
- Artifact: `docs/assets/demo/commercial-proof-report.json`

## Screenshot Capture Result

- Status: PASS
- Script: `tools/scripts/capture-commercial-screenshots.mjs`
- Artifacts:
  - `docs/assets/screenshots/commercial-dashboard.png`
  - `docs/assets/screenshots/commercial-readiness.png`
  - `docs/assets/screenshots/commercial-admin.png`
  - `docs/assets/screenshots/commercial-security.png`
  - `docs/assets/screenshots/commercial-workflow.png`
  - `docs/assets/screenshots/commercial-approvals.png`
  - `docs/assets/screenshots/commercial-incidents.png`
  - `docs/assets/screenshots/commercial-audit.png`
  - `docs/assets/screenshots/commercial-simulation.png`

## Key Observations

- Policy gate correctly blocked live high-risk path
- Approval unblocked execution and completed tool flow
- Audit events captured workflow and approval actions
- Evidence IDs were generated and queryable
- Policy Studio preview shows `ALLOW / REQUIRE_APPROVAL / DENY` impact before save
- Blocking policy downgrades require break-glass metadata
- Copilot endpoint returns safer policy suggestions and plain-language hints

## Remaining Test Gaps

- No load/performance baseline yet
- No chaos test suite yet
- No connector contract tests against external systems yet

## Next Recommended Test Expansions

1. Add contract tests for every connector manifest
2. Add policy regression suites per data class
3. Add replay-determinism verification tests
4. Add multi-tenant isolation abuse tests
