# Vulnerability Remediation Status

Verification date: 2026-04-01

This document records the rerun evidence for the remediated backend, frontend, and dependency-related vulnerability findings.

## Summary

| Area | Previous status | Current status | Verification evidence |
| --- | --- | --- | --- |
| Backend API gateway incident authorization | Reported as reproducible; regression tests were documented as failing with expected `403` vs actual `200`. | `PASS` | `npm test --workspace @openaegis/api-gateway` completed with `23/23` tests passing, including the incident and agent-graph authorization regressions. |
| Frontend admin-console governance guards | Reported as reproducible; new route-guard tests were documented as expected failures until hardening landed. | `PASS` | `npm run --workspace @openaegis/admin-console test` completed with `10/10` tests passing, including the AAL3 and tenant-scope regressions. |
| Security regression suite | Required for end-to-end confirmation after remediation. | `PASS` | `npm run security:regression` exited `0` and produced `summary.status = PASS`, `passedChecks = 14`, `failedChecks = 0`. |
| Dependency and secrets scan | Required to confirm no remaining known package or secret-scan exposure in the current workspace state. | `PASS` | `node tools/scripts/vuln-scan-dependencies.mjs` exited `0` and produced `summary.status = PASS` with `0` audit vulnerabilities and `0` secret findings. |

## PASS Criteria

Remediation verification is `PASS` only if all of the following are true:

1. `npm test --workspace @openaegis/api-gateway` exits with code `0` and both backend regression tests pass.
2. `npm run --workspace @openaegis/admin-console test` exits with code `0` and both frontend regression tests pass.
3. `npm run security:regression` exits with code `0` and reports `summary.status = PASS` with zero failed checks.
4. `node tools/scripts/vuln-scan-dependencies.mjs` exits with code `0`, reports zero dependency audit vulnerabilities, and reports zero secret findings.

## Command Evidence

### 1. Backend verification

Command:

```bash
npm test --workspace @openaegis/api-gateway
```

Observed result:

- Exit code: `0`
- Tests: `23`
- Passed: `23`
- Failed: `0`
- Key regressions now passing:
  - `incident endpoints require privileged roles even within the same tenant`
  - `agent graph incident views require privileged roles`

### 2. Frontend verification

Command:

```bash
npm run --workspace @openaegis/admin-console test
```

Observed result:

- Exit code: `0`
- Tests: `10`
- Passed: `10`
- Failed: `0`
- Key regressions now passing:
  - `governance routes should demand AAL3 step-up instead of exposing admin surfaces at AAL2`
  - `governance routes should be tenant-scoped instead of trusting cross-tenant privileged sessions`

### 3. Security regression verification

Command:

```bash
npm run security:regression
```

Observed result:

- Exit code: `0`
- Report timestamp: `2026-04-01T14:53:22.792Z`
- Total checks: `14`
- Passed checks: `14`
- Failed checks: `0`
- Summary status: `PASS`

Important confirmed controls:

- demo login disabled by default
- token introspection enforced
- cross-tenant writes blocked
- approval list requires privileged roles
- break-glass required for blocking policy changes
- revoked tokens denied via introspection

### 4. Dependency and secrets verification

Command:

```bash
node tools/scripts/vuln-scan-dependencies.mjs
```

Observed result:

- Exit code: `0`
- Report timestamp: `2026-04-01T14:53:30.591Z`
- Summary status: `PASS`
- Full dependency audit vulnerabilities: `0`
- Production dependency audit vulnerabilities: `0`
- Hardcoded secret findings: `0`
- Unaccepted dependency install scripts: `0`

Accepted install-script inventory noted by the scan:

- `esbuild@0.27.4` (`dev`)
- `fsevents@2.3.3` (`dev`, optional)
- `playwright/node_modules/fsevents@2.3.2` (`dev`, optional)

## Conclusion

All requested verification commands passed on 2026-04-01. The backend and frontend vulnerabilities previously documented as reproducible now meet explicit PASS criteria, and the regression and dependency scans did not surface residual failures in this verification run.
