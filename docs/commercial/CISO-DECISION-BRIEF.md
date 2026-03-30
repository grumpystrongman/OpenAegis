# OpenAegis CISO Decision Brief

This brief is written for security leadership evaluating whether OpenAegis should be the trust layer for enterprise AI agents.

## Executive Answer

Use OpenAegis when your core risk is not model quality, but unsafe execution: data leakage, unapproved high-risk actions, and weak incident evidence.

OpenAegis makes those controls enforceable outside the model and testable in CI.

## Why Now

Most agent stacks can generate actions. Very few can prove:

- risky actions were blocked before execution
- required approvals were enforced
- policy changes were controlled with break-glass governance
- incident evidence is replayable and tamper-evident

For hospitals and regulated enterprises, that proof is the deployment gate.

## What OpenAegis Does That Most Alternatives Do Not

1. Enforces policy outside the model execution path.
2. Requires human approval for high-risk live actions.
3. Applies kill-switch containment with immutable event chains.
4. Produces exportable evidence packages for security/compliance review.
5. Runs deterministic trust proofs across healthcare, finance, and secops scenarios.
6. Maintains vendor-neutral model routing rather than provider lock-in.

## Security Control Differences (Practical)

| Security concern | Common gap in generic stacks | OpenAegis control |
| --- | --- | --- |
| Model output suggests unsafe action | App trusts model/tool chain too early | Policy decision and tool guard enforce deny/approval before execution |
| High-risk action has no human review | Approval process is optional/custom | Approval is first-class and tested in live flows |
| Emergency containment is ad hoc | No scoped circuit break at trust layer | Kill-switch trigger/release with chain verification |
| Security review requires manual story-telling | Logs are fragmented | Evidence pack with checksums, run artifacts, and KPI summaries |
| Lock-in risk | Provider-specific assumptions leak into core flow | Model broker abstraction and policy-based routing |

## Evidence You Can Verify Today

Run this from repo root:

```bash
npm install
npm run pilot:local
npm run challenge:launch
```

Review these artifacts:

- `docs/assets/demo/readiness-gate-report.json`
- `docs/assets/demo/trust-layer-proof-report.json`
- `docs/assets/demo/codebase-line-audit-report.json`
- `docs/assets/demo/design-partner-kpis.json`
- `docs/assets/security-evidence-pack/latest/manifest.json`
- `docs/assets/security-evidence-pack/latest/EXECUTIVE-SUMMARY.md`

## Decision Criteria (Go / No-Go)

Go only if all are true:

- readiness gate status is `PASS` and score >= 98
- trust-layer examples pass `3/3`
- blocked risky actions >= 3 in design-partner KPIs
- audit completeness >= 98%
- security evidence pack manifest status is `PASS`

If one fails, rollout should remain blocked.

## Operational Advantage

OpenAegis reduces enterprise rollout friction by giving security teams:

- a repeatable acceptance test (`readiness:gate`)
- a line-level skeleton audit (`audit:codebase`)
- a buyer-facing trust challenge (`challenge:launch`)
- a machine-verifiable evidence package (`evidence:security-pack`)

That shifts conversations from claims to proof.

## Business Advantage

- Faster security sign-off for agent pilots
- Lower risk of compliance exceptions from uncontrolled workflows
- Provider flexibility without rewriting trust controls
- Clear commercial path: open AGPL core + commercial license + enterprise support

## Bottom Line

OpenAegis is not “another agent framework.”  
It is the control and proof layer that determines whether enterprise agents can be deployed safely at all.
