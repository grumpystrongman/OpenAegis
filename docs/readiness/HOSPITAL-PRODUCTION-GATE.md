# Hospital Production Gate

This document defines the minimum release gate for putting the OpenAegis pilot in front of a hospital, health system, or other regulated enterprise.

The rule is simple:

- if a required check fails, the release is a no-go
- if a required check passes, the release may proceed to the next gate only after evidence review

This gate is based on executable repository checks, not on subjective confidence.

## Scope

The production gate covers:

- code correctness
- build integrity
- unit and integration tests
- end-to-end pilot behavior
- commercial proof generation
- evidence bundle integrity

It does not replace security review, architecture review, or change management. It is the release gate for the code and demo path itself.

## Go/No-Go Criteria

| Check | Command | Pass condition | Evidence expected |
| --- | --- | --- | --- |
| Type correctness | `npm run typecheck` | Exit code 0 | No TypeScript errors |
| Build integrity | `npm run build` | Exit code 0 | All workspaces compile successfully |
| Test suite | `npm run test` | Exit code 0 | All tests pass |
| Pilot smoke test | `npm run smoke:pilot` | Exit code 0 | Pilot flow boots and completes the smoke scenario |
| Commercial proof | `npm run proof:commercial` | Exit code 0 | `docs/assets/demo/commercial-proof-report.json` is generated |

## Required Pass Results

The release is only considered ready when all of the following are true:

1. `npm run typecheck` passes.
2. `npm run build` passes.
3. `npm run test` passes.
4. `npm run smoke:pilot` passes.
5. `npm run proof:commercial` passes.
6. The commercial proof report records `summary.status = PASS`.
7. The commercial proof report records `summary.failedClaims = 0`.
8. The commercial proof report records `summary.scorePercent = 100`.

If any one of these checks fails, the gate is closed.

## Release Decision Rules

### Go

Release may proceed when:

- all five commands above succeed
- proof output is regenerated in the current commit
- the report is stored in `docs/assets/demo/commercial-proof-report.json`
- no unresolved production blockers remain in the release ticket

### No-Go

Release must stop when:

- any command exits non-zero
- the proof report does not regenerate
- the proof report score drops below 100
- the report contains at least one failed claim
- a smoke or build step requires manual intervention to finish

### Conditional Go

Conditional go is allowed only when:

- the defect is documented
- the risk is explicitly accepted
- the release owner and security owner both sign off
- the release ticket points to the remediation plan

## Release Checklist

Before approving a production release, verify:

- repository build is clean
- pilot demo still runs from current source
- commercial proof report matches the current commit
- screenshots match live route-specific pages
- manuals and setup docs are current
- no new unsafe defaults were introduced

## Failure Handling

If the gate fails:

1. Stop release work.
2. Record the failing command and exact exit output.
3. Reproduce the failure locally.
4. Fix the root cause.
5. Rerun the failing command.
6. Rerun the full gate sequence.

Do not advance a release on partial success.

## Evidence Bundle

The expected evidence bundle for a gate review is:

- `npm run typecheck` output
- `npm run build` output
- `npm run test` output
- `npm run smoke:pilot` output
- `npm run proof:commercial` output
- `docs/assets/demo/commercial-proof-report.json`
- `docs/assets/demo/pilot-demo-output.json`

## Gate Owner Responsibilities

The gate owner must confirm:

- the release candidate matches the evidence bundle
- the proof report was generated from the same commit under review
- there are no stale screenshots or stale demos
- any manual override is recorded with a reason and approver

## Interpretation

This gate is intentionally strict.

For a regulated enterprise, a release is not ready because the app mostly works.
It is ready because the app works, the tests prove it, and the evidence is reproducible.
