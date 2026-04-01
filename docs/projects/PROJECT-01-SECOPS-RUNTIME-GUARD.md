# Project 01 - SecOps Runtime Guard

## Who This Is For

- CISO
- SOC manager
- incident commander
- platform security admin

## What This Pack Shows

OpenAegis can stop a risky security action even when the model wants to do it.
It can also make the human approval step obvious and auditable.

## Recommended Stack

Use open-source systems that security teams already know:

- Kafka for alerts
- Grafana for incident views
- Prometheus for alert signals
- OpenSearch or Loki for logs
- Keycloak for identity
- Vault for break-glass credentials
- Kubernetes for containment targets
- OPA for policy integration
- ServiceNow or Jira for incident tasks

## Settings You Must Configure

1. `tenantId`: the tenant or business unit being protected.
2. `workflowId`: `wf-secops-runtime-guard`.
3. `classification`: `SECRET` for simulated threat payloads.
4. `zeroRetentionRequested`: `true` for any sensitive content.
5. `requestFollowupEmail`: usually `false` for security demos.
6. `toolExecutionBudget`: keep it low, such as `6`.
7. `approvalRequired`: `true` for live containment steps.
8. `connectorScopes`: read-only for search, write only for approved containment.

## Required Policies

- Deny secret exfiltration by default.
- Require approval for high-risk live actions.
- Deny any action that exceeds the tool budget.
- Only the security-admin or platform-admin role can change the policy baseline.
- Break-glass requires a ticket, justification, and dual approval.

## Human-in-the-Loop Example

A threat is detected on a production node.
OpenAegis proposes host isolation.
The policy engine marks the live action as `REQUIRE_APPROVAL`.
An incident commander reviews the evidence, approves the action, and only then does the containment step run.
The audit trail records the decision, the approver, the execution ID, and the evidence ID.

## Daily Use Scenarios

### 1. Morning alert review

- Open the runtime alerts table.
- Check the highest-severity rows.
- Confirm the `blocked` status for anything that looks like exfiltration.
- Use the dashboard to see open incidents and current approval queue length.

### 2. Live containment during an incident

- Select the host quarantine action.
- Check that the action is marked `REQUIRE_APPROVAL`.
- Submit the approval request.
- Wait for the incident commander.
- Re-run after approval and confirm the execution is single-use.

### 3. Post-incident review

- Open the audit explorer.
- Pull the evidence chain for the containment action.
- Review policy reasons and the approval record.
- Export the incident packet for the after-action review.

## Dashboard Views By Persona

- CISO: open incidents, blocked actions, break-glass usage, policy changes.
- SOC manager: approval backlog, containment throughput, mean time to decision.
- Incident commander: active events, exact action proposed, evidence snapshot.
- Security admin: policy drift, connector risk, redaction coverage.

## Step-By-Step Demo Flow

1. Connect evaluator identities.
2. Open the SecOps pack.
3. Review the seeded alert rows.
4. Review the policy rules and scenario decisions.
5. Apply the secure baseline.
6. Run simulation.
7. Run live.
8. Approve the request.
9. Verify the final execution and evidence IDs.

## Troubleshooting

- If the approval box never appears, the live mode was not selected.
- If policy cannot be saved, the role is too weak.
- If the dashboard is empty, reconnect demo identities and refresh.
- If an action runs without approval, treat it as a defect.

## Screenshot References

- `docs/assets/screenshots/commercial-projects.png`
- `docs/assets/screenshots/commercial-security.png`
- `docs/assets/screenshots/commercial-approvals.png`
- `docs/assets/screenshots/commercial-audit.png`
