# OpenAegis Design-Partner Pilot Program

This program runs three parallel pilots that prove trust controls in materially different operational contexts.

## Runbook Commands

```bash
npm run proof:trust-layer
npm run pilot:kpis
```

Outputs:

- `docs/assets/demo/trust-layer-proof-report.json`
- `docs/assets/demo/design-partner-kpis.json`

## Pilot 1: Hospital Ops

- Goal: Safe discharge automation with mandatory approval on high-risk live actions.
- Core KPI: `approvalLatencyMs <= 1500`
- Secondary KPI: `auditCompletenessPercent >= 98`

## Pilot 2: Finance Ops

- Goal: Block unsafe exports and preserve reliability through idempotent retries.
- Core KPI: `blockedRiskyActions >= 1`
- Secondary KPI: `auditCompletenessPercent >= 98`

## Pilot 3: Security Ops

- Goal: Rapid containment via kill switch, with break-glass governance and immutable event chain.
- Core KPI: `blockedRiskyActions >= 1`
- Secondary KPI: `auditCompletenessPercent >= 98`

## Global Success Gate

The program is considered commercially viable when all are true:

- readiness score >= 98
- global blocked risky actions >= 3
- global audit completeness >= 98
- all trust examples pass

If any KPI fails, the pilot remains in remediation mode.
