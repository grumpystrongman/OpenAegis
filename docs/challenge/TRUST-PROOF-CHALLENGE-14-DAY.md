# OpenAegis Trust Proof Challenge (14 Days)

This challenge is a reproducible buyer-evaluation program built around real controls evidence.

## Objective

By Day 14, an external evaluator should be able to:

- run OpenAegis locally with one command
- validate the 3 trust examples (healthcare, finance, secops)
- inspect evidence artifacts for security and compliance review
- score pilot KPIs with explicit pass/fail thresholds

## One-Command Launch

```bash
npm install
npm run challenge:launch
```

Launch artifact:

- `docs/assets/challenge/trust-proof-challenge-launch.json`

## Daily Plan

1. Day 1: Environment bring-up and dependency validation (`npm run readiness:gate`).
2. Day 2: Trust example #1 deep run (healthcare discharge).
3. Day 3: Trust example #2 deep run (finance guardrails).
4. Day 4: Trust example #3 deep run (secops containment).
5. Day 5: Security regression gate (`npm run security:regression`).
6. Day 6: KPI baseline capture (`npm run pilot:kpis`).
7. Day 7: Security evidence pack publication (`npm run evidence:security-pack`).
8. Day 8: Midpoint review and gap triage.
9. Day 9: Policy variation tests (safe tightening only).
10. Day 10: Approval workflow timing review.
11. Day 11: Audit replay walkthrough with non-engineering stakeholders.
12. Day 12: Chaos and load rerun.
13. Day 13: Security/compliance checkpoint.
14. Day 14: Final go/no-go with evidence package.

## Required Pass Criteria

- `docs/assets/demo/trust-layer-proof-report.json`: `summary.status = PASS`
- `docs/assets/demo/security-regression-report.json`: `summary.status = PASS`
- `docs/assets/demo/readiness-gate-report.json`: `summary.status = PASS` and `summary.scorePercent >= 98`
- `docs/assets/demo/design-partner-kpis.json`: `summary.status = PASS`
- `docs/assets/demo/enterprise-trust-pack-audit-report.json`: `summary.status = PASS`
- `docs/assets/security-evidence-pack/latest/manifest.json`: `status = PASS`

## Scorecard Template

Use `docs/challenge/TRUST-PROOF-SCORECARD.csv` to track daily outcomes and blockers.

## Evaluator Deliverables

- Trust proof report
- Security regression report
- Readiness gate report
- Design-partner KPI report
- Security evidence pack (latest)

If any required pass criterion fails, rollout remains blocked until remediated and rerun.
