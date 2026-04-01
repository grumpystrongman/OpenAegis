# Project 05 - Board Risk Cockpit

## Who This Is For

- CEO
- board secretary
- risk committee member
- executive analyst
- CISO or COO reviewer

## What This Pack Shows

OpenAegis can prepare a board-ready risk view without turning the board deck into a free-form chatbot output.
It gives executives something better than a static report: evidence-backed, policy-checked, and role-aware reporting.

## Recommended Stack

- Trino for governed data access
- Kafka for events
- Airbyte for source sync
- dbt for metrics and transformations
- Grafana for operational trends
- Superset for board reporting
- PostgreSQL for risk register state
- Keycloak for identity
- Vault for secrets
- OpenSearch for evidence search

## Settings You Must Configure

1. `tenantId`: the enterprise tenant.
2. `workflowId`: `wf-board-risk-cockpit`.
3. `classification`: `CONFIDENTIAL`.
4. `zeroRetentionRequested`: `true`.
5. `requestFollowupEmail`: `false`.
6. `toolExecutionBudget`: `6` or lower.
7. `approvalRequired`: `true` for live publication.
8. `disclosureScope`: board-only unless explicitly approved otherwise.

## Required Policies

- Confidential live publication requires approval.
- External disclosure is denied by default.
- Every board claim must have an evidence reference.
- Freshness and lineage checks must pass before a metric can be published.
- Manual overrides must include who approved them and why.

## Human-in-the-Loop Example

A board pack is ready, but one metric is stale.
OpenAegis excludes it and explains why.
If leadership wants the stale metric anyway, they must approve the exception.
The approval record and the reason appear in the audit trail so the board can see what changed.

## Daily Use Scenarios

### 1. Weekly executive review

- Open the risk register.
- Check the trend lines and top exposures.
- Verify that each claim has evidence.
- Use the executive dashboard to review readiness and exceptions.

### 2. Board pack generation

- Assemble the pack in simulation.
- Review source freshness and lineage.
- Route the final publication step for approval.
- Publish the approved pack.
- Check the publication record.

### 3. Exception review

- Open the metric that failed freshness or lineage.
- Confirm it was excluded.
- Decide whether an approved override is justified.
- If approved, record the exception reason and keep it visible in the audit trail.

## Dashboard Views By Persona

- CEO: risk trend, exception count, readiness score, business impact.
- Board secretary: publication status, approval status, package version.
- CISO: cyber risk, policy exceptions, evidence gaps.
- COO: operational risk, source freshness, owner follow-up.
- Executive analyst: metric lineage, refresh failures, draft vs approved state.

## Step-By-Step Demo Flow

1. Connect evaluator identities.
2. Open the Board Risk pack.
3. Review the risk register.
4. Review the policy scenarios.
5. Apply the secure baseline.
6. Run simulation.
7. Run live.
8. Approve the publication.
9. Inspect the final board-ready dashboard and evidence.

## Troubleshooting

- If board claims appear without evidence, the pack is not safe.
- If external recipients can see the output, disclosure controls are broken.
- If freshness failures do not block publication, the policy rules need fixing.
- If approval is skipped, stop the demo.

## Screenshot References

- `docs/assets/screenshots/commercial-projects.png`
- `docs/assets/screenshots/commercial-dashboard.png`
- `docs/assets/screenshots/commercial-readiness.png`
- `docs/assets/screenshots/commercial-audit.png`
