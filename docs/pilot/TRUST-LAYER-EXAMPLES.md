# OpenAegis Trust Layer: 3 End-to-End Proof Examples

This guide demonstrates three materially different, executable scenarios that prove OpenAegis trust controls.

## Run the Proof Harness

```bash
npm run proof:trust-layer
```

Output artifact:

- `docs/assets/demo/trust-layer-proof-report.json`
- includes KPI fields for each example (`approvalLatencyMs`, `blockedRiskyActions`, `auditCompletenessPercent`)

## Example 1: Hospital Discharge Assistant (Healthcare)

- Persona: Care coordinator + security approver
- Pain solved: Team can automate discharge workflow without bypassing policy/approval controls.
- Trust controls proven:
  - High-risk live action policy gate
  - Human approval requirement
  - Deterministic planner/executor/reviewer checkpoints
  - Replayable audit evidence

Pass condition:

- Execution starts as `blocked`
- Approval is required and granted
- Execution transitions to `completed`
- Graph stages are `planner -> executor -> reviewer`

## Example 2: Finance Close Guardrails (Finance Ops)

- Persona: Finance operations manager
- Pain solved: Prevents accidental outbound leakage while keeping retries safe and manageable.
- Trust controls proven:
  - Enterprise connector catalog visibility
  - Runtime block for unapproved outbound action
  - Idempotent replay on duplicate call
  - Policy obligations for live operations (DLP/logging)

Pass condition:

- Unapproved outbound tool execution is blocked
- Idempotent replay returns same `toolCallId`
- Policy decision includes `dlp_scan_required`

## Example 3: SecOps Containment + Governance (Security Ops)

- Persona: Security operations lead
- Pain solved: Enables controlled emergency actions without unmanaged policy drift.
- Trust controls proven:
  - Break-glass required for blocking-risk policy changes
  - Scoped kill-switch containment
  - Immutable kill-switch event chain verification
  - Baseline policy restoration after drill

Pass condition:

- Unsafe policy downgrade without break-glass is rejected
- Same downgrade with valid break-glass is accepted
- Kill-switch trigger/release succeeds
- Event chain verifies as valid
- Baseline secure controls restored

## Commercial Interpretation

This is not a toy demo. These examples prove operational controls buyers ask for:

- "Can unsafe actions be stopped before execution?"
- "Can humans approve high-risk actions?"
- "Can we contain incidents quickly?"
- "Can we audit and replay what happened?"

If all three examples pass, OpenAegis proves real trust-plane behavior under realistic workflows.
