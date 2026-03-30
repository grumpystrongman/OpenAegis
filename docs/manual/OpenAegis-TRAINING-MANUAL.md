# OpenAegis Training Manual

## Before You Start

OpenAegis is a safety-first agent platform.

Think of it as a guarded workflow engine:

- the AI suggests
- OpenAegis checks
- humans approve risky live actions
- evidence is recorded

## Training Path

### Module 1: Understand the Safety Model

Goal: explain in one minute how OpenAegis prevents unsafe automation.

Checklist:

- describe policy outside model
- describe approval gate
- describe audit evidence chain

### Module 2: Run Simulation First

1. Open Simulation Lab.
2. Run discharge workflow in simulation mode.
3. Confirm execution result and model route.
4. Review evidence IDs.

Pass condition: simulation completes and evidence is visible.

### Module 3: Run Live with Approval

1. Run workflow in live mode.
2. Confirm status blocks for high-risk action.
3. Open Approval Inbox.
4. Approve request.
5. Confirm workflow completes after approval.

Pass condition: completion only happens after approval.

### Module 4: Change Policy Safely

1. Open Security Console -> Policy Studio.
2. Change one control.
3. Run Preview Impact.
4. Read warnings.
5. Ask Copilot and compare recommendation.
6. Apply policy.

Pass condition: trainee can explain impact in plain language.

### Module 5: Audit and Incident Review

1. Open Audit Explorer.
2. Filter by execution ID.
3. Open Incident Review Explorer.
4. Map evidence ID -> policy decision -> approval -> final outcome.

Pass condition: trainee can reconstruct workflow timeline from evidence.

## Practical Lab (Single Flow)

Run one full cycle:

1. simulation
2. live block
3. approval decision
4. final completion
5. policy preview
6. audit review

## If You Remember Only Five Things

1. Run simulation before live.
2. Policy is outside the model.
3. High-risk live actions need approvals.
4. Every major action must be traceable by evidence ID.
5. If unsure, keep safer defaults.
