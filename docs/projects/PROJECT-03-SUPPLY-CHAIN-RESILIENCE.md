# Project 03 - Supply Chain Resilience

## Who This Is For

- COO
- supply chain lead
- procurement manager
- operations analyst
- finance approver

## What This Pack Shows

OpenAegis can detect a shortage, draft a mitigation plan, and still stop unsafe or duplicate procurement actions.
It is good for real operations because it keeps the action bounded and auditable.

## Recommended Stack

- Airbyte for inbound feeds
- Kafka for event streams
- Dagster or Airflow for orchestration
- Trino for governed analytics
- PostgreSQL for work state
- Grafana for operational dashboards
- Linear or Jira for task tracking
- Keycloak for identity
- Vault for secrets
- Kubernetes for the runtime

## Settings You Must Configure

1. `tenantId`: the operations tenant.
2. `workflowId`: `wf-supply-chain-resilience`.
3. `classification`: usually `INTERNAL` or `CONFIDENTIAL`.
4. `zeroRetentionRequested`: `true`.
5. `requestFollowupEmail`: `false`.
6. `toolExecutionBudget`: `6` or lower.
7. `approvalRequired`: `true` for procurement write actions.
8. `idempotencyKey`: required for anything that creates or updates a task or order.

## Required Policies

- Procurement writes require approval.
- Over-budget execution must be denied.
- Duplicate actions are not allowed on retry.
- Source feeds must have lineage before they are used in a plan.
- Supplier risk, embargo, and cost checks must happen before a recommendation is shown.

## Human-in-the-Loop Example

A critical item drops below the safety threshold.
OpenAegis drafts a resupply plan and a task for procurement.
If the workflow wants to create a purchase order, it stops and asks for approval.
After finance or procurement approves, the order can proceed once, and the system records the idempotency binding so the same approval cannot be reused for a different action.

## Daily Use Scenarios

### 1. Morning shortage scan

- Open the inventory watchlist.
- Sort by hours left.
- Check the highest-risk items.
- Use the operations dashboard to see how many shortages are still open.

### 2. Create a mitigation task

- Choose a shortage.
- Ask OpenAegis to draft the mitigation plan.
- Review task ownership and priority.
- Send it to the task system.
- Verify the task ID and evidence trail.

### 3. Approve a live purchase order

- Open the live procurement step.
- Confirm the action requires approval.
- Review cost delta and supplier risk.
- Approve or reject.
- Verify that the system does not duplicate the order if the request is retried.

## Dashboard Views By Persona

- COO: shortage count, open risk by site, time to assignment, on-time mitigation.
- Procurement manager: pending tasks, approval queue, supplier risk, duplicate prevention alerts.
- Finance approver: cost delta, threshold breaches, approved spend, blocked spend.
- Operations analyst: watchlist, task ownership, execution status, evidence quality.

## Step-By-Step Demo Flow

1. Connect evaluator identities.
2. Open the Supply Chain pack.
3. Inspect the shortage rows.
4. Review the policy scenarios.
5. Apply the secure baseline.
6. Run simulation.
7. Run live.
8. Approve the purchase-order step.
9. Check the task system and dashboard.

## Troubleshooting

- If duplicate tasks appear, the idempotency key is missing or reused incorrectly.
- If a purchase order goes live without approval, stop and inspect policy settings.
- If task ownership is blank, the workflow was not seeded correctly.
- If the dashboard does not move after approval, refresh live data.

## Screenshot References

- `docs/assets/screenshots/commercial-projects.png`
- `docs/assets/screenshots/commercial-workflow.png`
- `docs/assets/screenshots/commercial-dashboard.png`
- `docs/assets/screenshots/commercial-audit.png`
