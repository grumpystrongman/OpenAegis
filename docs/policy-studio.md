# OpenAegis Policy Studio Guide

This guide explains how to configure security policy in OpenAegis without writing code.

## In Plain English

Policy Studio is the screen where you decide what AI workflows are allowed to do.

- If a setting is safe, workflows continue.
- If a setting is risky, OpenAegis warns you before you save.
- If a change is very risky, OpenAegis requires break-glass details.

## Where to Find It

1. Start the app.
2. Open **Security Console**.
3. Use the **Policy Studio** panel.

## Controls You Can Configure

- `enforceSecretDeny`
- `requireZeroRetentionForPhi`
- `requireApprovalForHighRiskLive`
- `requireDlpOnOutbound`
- `restrictExternalProvidersToZeroRetention`
- `maxToolCallsPerExecution`

Each control in the UI includes:

- what it does
- why it matters
- what can go wrong if changed unsafely

## Safe Change Workflow

1. Update one or more controls.
2. Click **Preview impact**.
3. Read blocking issues and warnings.
4. Optional: click **Ask copilot** for plain-language feedback and a safer suggestion.
5. Click **Apply policy**.

## Understanding Warnings

- `blocking`: high-risk change that cannot be saved without break-glass details.
- `warning`: risky but allowed change. Review carefully before applying.
- `info`: non-critical guidance.

## Break-Glass Rules

If blocking controls are downgraded, saving requires:

- ticket ID
- justification text
- at least two approver IDs

Without those fields, the save request is rejected.

## Copilot Behavior

Policy copilot reviews your proposed controls and returns:

- summary of risk
- hints for safer operation
- suggested controls
- confidence score

Copilot source is either:

- `local-llm` when `OPENAEGIS_LOCAL_LLM_ENDPOINT` is configured
- `builtin` fallback logic when local LLM is unavailable

## API Endpoints (for automation)

- `GET /v1/policies/profile`
- `POST /v1/policies/profile/preview`
- `POST /v1/policies/profile/copilot`
- `POST /v1/policies/profile/save`

## Example Save Payload

```json
{
  "profileName": "Hospital Safe Baseline",
  "changeSummary": "Reduce false positives while keeping PHI safeguards",
  "controls": {
    "requireApprovalForHighRiskLive": true,
    "maxToolCallsPerExecution": 10
  }
}
```

## Example Break-Glass Payload

```json
{
  "profileName": "Emergency Override",
  "changeSummary": "Emergency operational continuity",
  "controls": {
    "enforceSecretDeny": false
  },
  "breakGlass": {
    "ticketId": "BG-2026-001",
    "justification": "Emergency continuity under compliance supervision.",
    "approverIds": ["security-lead-1", "compliance-lead-2"]
  }
}
```

## Operator Rule of Thumb

If you are unsure, keep the safer default and run simulation first.
