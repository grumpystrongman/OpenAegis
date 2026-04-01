# Project 02 - Revenue Cycle Copilot

## Who This Is For

- revenue integrity lead
- CFO
- billing supervisor
- analyst
- compliance reviewer

## What This Pack Shows

OpenAegis helps finance teams work through denials without letting PHI leak into unsafe paths.
It can suggest, explain, and stage the work, but it still needs policy and approvals for the risky parts.

## Recommended Stack

Use systems that a hospital finance team would actually recognize:

- Trino for governed SQL access
- Airflow for recurring work
- dbt for metric logic
- Superset or Metabase for finance dashboards
- Kafka for event handling
- PostgreSQL for work queues
- Keycloak for identity
- Vault for secrets
- FHIR APIs for patient context
- SFTP for payer files

## Settings You Must Configure

1. `tenantId`: the finance tenant.
2. `workflowId`: `wf-revenue-cycle-copilot`.
3. `classification`: `PHI` or `EPHI` for claim work.
4. `zeroRetentionRequested`: `true`.
5. `requestFollowupEmail`: `false` unless a test recipient is used.
6. `toolExecutionBudget`: `7` or lower.
7. `approvalRequired`: `true` for live writeback.
8. `redactionOnOutbound`: `true`.

## Required Policies

- PHI must route only to zero-retention approved providers.
- Live claim writeback requires supervisor approval.
- Outbound packets must be redacted and hashed.
- Role access must separate analyst work from approver work.
- Any claim edit must keep source citation and field diff.

## Human-in-the-Loop Example

An analyst finds a denial that needs an appeal packet.
OpenAegis builds the packet and marks the live writeback step as approval required.
The billing supervisor checks the PHI-safe summary, approves the packet, and only then does the system send the final update.
The evidence record shows what data was used, what was redacted, who approved it, and when it was sent.

## Daily Use Scenarios

### 1. Denial triage start of day

- Open the denial queue.
- Sort by amount and aging.
- Check which items are simulation-safe and which need human review.
- Use the dashboard to see backlog, turnaround, and approval status.

### 2. Prepare an appeal packet

- Select a denial row.
- Ask OpenAegis to draft a packet.
- Review the redacted output.
- If the packet is going live, route it to approval.
- Confirm the final packet hash and export record.

### 3. Finance performance review

- Check monthly denial trend.
- Review appeal acceptance rate.
- Compare the operational dashboard with the evidence trail.
- Use the KPI card to decide whether the workflow is helping or creating friction.

## Dashboard Views By Persona

- CFO: denial dollars, appeal recovery, turnaround time, policy exception count.
- Billing supervisor: queue depth, pending approvals, packet quality, rework rate.
- Analyst: open tasks, redaction warnings, draft packet completeness.
- Compliance reviewer: outbound hash trail, source citations, audit completeness.

## Step-By-Step Demo Flow

1. Connect evaluator identities.
2. Open the Revenue Cycle pack.
3. Review the denial queue.
4. Review the policy rules and scenario outcomes.
5. Apply the secure baseline.
6. Run simulation.
7. Run live.
8. Approve the appeal writeback.
9. Inspect the audit trail and dashboard impact.

## Troubleshooting

- If PHI appears in an output, stop and inspect the redaction policy.
- If the live writeback does not wait for approval, the configuration is wrong.
- If the dashboard does not show backlog or turnaround, the demo data was not refreshed.
- If the plan exceeds the budget, reduce the tool-call limit.

## Screenshot References

- `docs/assets/screenshots/commercial-projects.png`
- `docs/assets/screenshots/commercial-dashboard.png`
- `docs/assets/screenshots/commercial-approvals.png`
- `docs/assets/screenshots/commercial-readiness.png`
