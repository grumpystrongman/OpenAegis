# OpenAegis Commercial Readiness

OpenAegis is a vendor-neutral trust and orchestration layer for enterprise AI agents in regulated environments.

Plain-language summary: it is the safety system around agents. It checks requests, blocks unsafe actions, requires human approval for risky live steps, and records evidence.

## What OpenAegis Solves

Hospitals and regulated enterprises need all of these at once:

- useful agent automation
- policy enforcement outside the model
- approval workflows for risky actions
- audit evidence for incident and compliance review
- freedom to change model providers without rewriting core logic

Most products only solve part of this.

## Why OpenAegis vs Alternatives

| Alternative class | Strength | Common gap | OpenAegis position |
| --- | --- | --- | --- |
| Generic agent framework | Fast to build workflows | Weak enterprise guardrails by default | Adds externalized policy, approvals, and replayable evidence |
| Vendor-native copilot platform | Easy onboarding | Provider lock-in and limited neutral governance | Keeps provider logic behind a broker interface |
| DIY orchestration | Custom freedom | High burden to prove control effectiveness | Ships executable control proofs and pilot evidence |

## Claim Ledger (What Is Proven Today)

| Claim | Status | Evidence artifact | How to verify |
| --- | --- | --- | --- |
| Policy is enforced outside model execution | Proven now | `backend/services/api-gateway/src/index.test.ts` | Run `npm run --workspace @openaegis/api-gateway test` |
| High-risk live workflows require approval by default | Proven now | Same test suite, approval tests | Run tests and inspect `approval_requested` flow |
| Blocking policy downgrades require break-glass fields | Proven now | Same test suite, break-glass test | Run tests and verify `422` without break-glass |
| Policy profile changes are previewable before apply | Proven now | `/v1/policies/profile/preview` + Security Console | Use Policy Studio Preview Impact |
| LLM-assisted policy review provides safer suggestions | Proven now (pilot-grade) | `/v1/policies/profile/copilot` | Use Ask Copilot in Security Console |
| End-to-end hospital workflow remains operational | Proven now | smoke script output | Run `npm run smoke:pilot` |
| Commercial scorecard and proof bundle export | Proven now | `docs/assets/demo/commercial-proof-report.json` | Run `npm run proof:commercial` |
| Three distinct trust-layer examples pass end-to-end | Proven now | `docs/assets/demo/trust-layer-proof-report.json` | Run `npm run proof:trust-layer` |
| Repository-level commercial audit has no placeholder gaps | Proven now | `docs/assets/demo/commercial-audit-report.json` | Run `npm run audit:commercial` |
| One-command local pilot produces readiness + KPI + security evidence pack | Proven now | `docs/assets/security-evidence-pack/latest/manifest.json` | Run `npm run pilot:local` |
| Full enterprise connector depth and formal certifications | Roadmap | n/a | Not claimed as complete in this MVP |

## Policy Configuration Experience (Buyer-Facing)

Security admins can configure policy without editing code.

1. Open Security Console -> Policy Studio.
2. Change controls with plain-language descriptions.
3. Preview impact (allow/approval/deny mix + warnings).
4. Ask Copilot for explanation and auto-fix suggestion.
5. Save profile.
6. If blocking controls are weakened, break-glass ticket + dual approver IDs are required.

This is intentionally explicit so a non-expert can operate safely.

## Evidence and Demo Assets

- `docs/assets/screenshots/commercial-security.png`
- `docs/assets/screenshots/commercial-approvals.png`
- `docs/assets/screenshots/commercial-audit.png`
- `docs/assets/screenshots/commercial-incidents.png`
- `docs/assets/screenshots/commercial-readiness.png`
- `docs/assets/demo/pilot-demo-output.json`
- `docs/assets/demo/commercial-proof-report.json`
- `docs/assets/demo/trust-layer-proof-report.json`
- `docs/assets/demo/commercial-audit-report.json`
- `docs/assets/demo/design-partner-kpis.json`
- `docs/assets/security-evidence-pack/latest/EXECUTIVE-SUMMARY.md`

## Buyer Evaluation Runbook

Use this sequence for technical due diligence:

1. Run simulation workflow.
2. Run live workflow and confirm high-risk action blocks.
3. Approve in Approval Inbox and confirm completion.
4. Change policy in Policy Studio and run preview.
5. Trigger copilot review and apply suggested safe controls.
6. Re-run live workflow and compare behavior.
7. Inspect audit/incident traces and export proof artifacts.
8. Run `npm run pilot:local` and verify all gate summaries are `PASS`.

If these steps are not observable, treat claims as unproven.

## Bottom Line

OpenAegis is commercially meaningful when the buyer can verify three things:

- workflows execute
- unsafe actions are blocked or approval-gated
- evidence is exportable and replayable

This repository is designed to make those checks executable.
