# Frontend Vulnerability Verification Report

Scope:

- `frontend/apps/admin-console/src/app`

Verification date: 2026-04-01

## Remediation Status

Status: Remediated and verified

The previously reported admin-console route-guard issues are no longer reproducible. Governance routes now verify the required assurance level and tenant scope under test.

## Before / After

| Finding | Before remediation | After verification |
| --- | --- | --- |
| Missing step-up MFA on privileged governance routes | AAL2 privileged sessions could access `/security`, `/identity`, and `/admin` as long as role checks passed. | Regression test now passes and confirms governance routes require AAL3 step-up. |
| Governance routes ignored tenant scope | Cross-tenant privileged sessions could satisfy the UI guard for governance routes. | Regression test now passes and confirms governance routes reject mismatched tenant context. |

## PASS Criteria

The frontend remediation is `PASS` only if all of the following are true:

1. `npm run --workspace @openaegis/admin-console test` exits with code `0`.
2. Test `governance routes should demand AAL3 step-up instead of exposing admin surfaces at AAL2` passes.
3. Test `governance routes should be tenant-scoped instead of trusting cross-tenant privileged sessions` passes.
4. The admin-console test run completes with zero failed tests.

## Verification Evidence

Command run:

```bash
npm run --workspace @openaegis/admin-console test
```

Observed result:

- Exit code: `0`
- Total tests: `10`
- Passed: `10`
- Failed: `0`
- Duration: `202.8171ms`

Relevant passing tests:

- `governance routes should demand AAL3 step-up instead of exposing admin surfaces at AAL2`
- `governance routes should be tenant-scoped instead of trusting cross-tenant privileged sessions`

## Conclusion

Frontend governance-route vulnerabilities moved from reproduced to remediated. The verification evidence on 2026-04-01 satisfies all frontend PASS criteria.
