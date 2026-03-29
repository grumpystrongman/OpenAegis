# Smoke Test and Pilot Test Report

## Commands Executed

```bash
npm run typecheck
npm run test
npm run build
npm run smoke:pilot
node tools/scripts/pilot-demo.mjs
```

## Smoke Test Result

- Status: PASS
- Script: `tools/scripts/smoke-pilot.mjs`
- Last verified: `2026-03-29`
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

## Key Observations

- Policy gate correctly blocked live high-risk path
- Approval unblocked execution and completed tool flow
- Audit events captured workflow and approval actions
- Evidence IDs were generated and queryable
- Legacy pilot-state compatibility is now handled for older patient/user schemas

## Remaining Test Gaps

- No load/performance baseline yet
- No chaos test suite yet
- No connector contract tests against external systems yet

## Next Recommended Test Expansions

1. Add contract tests for every connector manifest
2. Add policy regression suites per data class
3. Add replay-determinism verification tests
4. Add multi-tenant isolation abuse tests
