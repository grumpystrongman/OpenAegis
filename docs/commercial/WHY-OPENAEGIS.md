# Why OpenAegis Wins in Regulated Enterprise AI

This document explains what OpenAegis does, why it is different, and how to verify those claims using executable checks.

## One-Sentence Positioning

OpenAegis is a control plane that lets enterprises run AI agents with policy, approvals, and evidence enforced outside the model.

For security leaders, see the buyer-focused brief: `docs/commercial/CISO-DECISION-BRIEF.md`.

## What Problem It Solves

Most agent stacks can generate actions but cannot prove safe operation in regulated environments. OpenAegis closes that gap by requiring:

- explicit policy decisions before risky actions
- approval gates for high-risk live operations
- replayable evidence for every major action
- deterministic simulation before production rollout

## Why It Is Better Than Generic Agent Frameworks

| Capability | Typical framework | OpenAegis |
| --- | --- | --- |
| Policy enforcement outside model | Partial or absent | Built-in and testable |
| Approval workflow for high-risk live actions | Usually custom | Included by default |
| Evidence chain and replay | Often ad hoc logs | Structured evidence with IDs |
| Vendor-neutral model routing | Mixed | Core design principle |
| Simulation before live execution | Inconsistent | First-class workflow mode |

## How To Verify Claims (No Marketing Hand-Waving)

Run these commands from repository root:

```bash
npm run test
npm run validate:test-surface
npm run validate:infra
npm run smoke:pilot
npm run proof:commercial
npm run load:commercial
npm run chaos:commercial
npm run audit:codebase
npm run readiness:gate
```

Expected results:

- all commands exit `0`
- `docs/assets/demo/commercial-proof-report.json` has `summary.status = PASS`
- `docs/assets/demo/codebase-line-audit-report.json` has `summary.status = PASS`
- `docs/assets/demo/readiness-gate-report.json` has `summary.scorePercent >= 98`

## How Non-Experts Can Operate It Safely

- Policy Studio explains each control in plain language.
- Impact Preview shows what policy outcomes change before save.
- Blocking-risk changes require break-glass metadata.
- Local/built-in policy copilot proposes safer settings and remediation hints.

## Buyer Evaluation Checklist

Use this list in a security and operations review:

1. Can the platform deny unsafe actions even when the model output suggests them?
2. Can we require human approval for high-risk live execution?
3. Can we replay who changed policy, what changed, and why?
4. Can we run simulation and compare behavior before go-live?
5. Can we prove these controls through automated checks in CI?

If any answer is no, treat rollout as no-go until the gap is closed.
