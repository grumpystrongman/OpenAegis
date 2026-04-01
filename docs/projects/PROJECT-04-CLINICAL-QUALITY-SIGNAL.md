# Project 04 - Clinical Quality Signal

## Who This Is For

- CMO
- quality director
- nurse manager
- care coordination lead
- compliance reviewer

## What This Pack Shows

OpenAegis can surface clinical quality risks while still protecting PHI and requiring human review for patient-impacting actions.
It is useful when the team needs speed but cannot accept sloppy data handling.

## Recommended Stack

- HAPI FHIR for clinical data access
- Kafka for event handling
- Airflow for scheduled measure runs
- dbt for cohort logic
- Superset or Metabase for quality dashboards
- PostgreSQL for review state
- Keycloak for roles
- Vault for secrets
- OpenSearch for note search
- Kubernetes for the runtime

## Settings You Must Configure

1. `tenantId`: the clinical tenant.
2. `workflowId`: `wf-clinical-quality-signal`.
3. `classification`: `PHI` or `EPHI`.
4. `zeroRetentionRequested`: `true`.
5. `requestFollowupEmail`: `false`.
6. `toolExecutionBudget`: `6` or lower.
7. `approvalRequired`: `true` for notifications and chart-impacting actions.
8. `purposeOfUse`: required when retrieving clinical data.

## Required Policies

- ePHI must route only to zero-retention approved paths.
- High-risk notifications require clinician approval.
- Purpose-of-use must be checked before retrieval.
- The model may summarize, but it cannot edit the source chart.
- All outputs must cite source rows and query versions.

## Human-in-the-Loop Example

A quality signal suggests a serious follow-up action.
OpenAegis builds the review packet and marks the outbound notification as risky.
The clinician or quality lead reviews the evidence, decides whether the action is appropriate, and approves it if needed.
The system records the decision, the data source, the query hash, and the notification evidence.

## Daily Use Scenarios

### 1. Start-of-shift quality scan

- Open the quality signal table.
- Sort by risk score.
- Check which signals are simulation-only and which require review.
- Use the dashboard to see pending cases and review age.

### 2. Prepare a care-team notification

- Select a high-risk signal.
- Draft the notification.
- Confirm the output is redacted and purpose-limited.
- Send it to approval.
- Verify the approval and outbound record.

### 3. Committee review

- Open the evidence bundle.
- Show the query version and source rows.
- Review whether the quality action was appropriate.
- Export the committee packet.

## Dashboard Views By Persona

- CMO: signal count, severity trend, review latency, unresolved high-risk cases.
- Quality director: measure completeness, evidence quality, reviewer backlog.
- Nurse manager: patient-facing queue, approval status, pending follow-up tasks.
- Compliance reviewer: PHI exposure checks, outbound message records, source lineage.

## Step-By-Step Demo Flow

1. Connect evaluator identities.
2. Open the Clinical Quality pack.
3. Review the signal rows.
4. Review the policy outcomes.
5. Apply the secure baseline.
6. Run simulation.
7. Run live.
8. Approve the notification.
9. Confirm dashboard and audit evidence.

## Troubleshooting

- If PHI appears in the summary, the redaction policy is not configured correctly.
- If a notification goes live without approval, treat it as a blocking defect.
- If the dashboard does not show case age, the data refresh failed.
- If purpose-of-use is missing, the retrieval should be denied.

## Screenshot References

- `docs/assets/screenshots/commercial-projects.png`
- `docs/assets/screenshots/commercial-simulation.png`
- `docs/assets/screenshots/commercial-approvals.png`
- `docs/assets/screenshots/commercial-security.png`
