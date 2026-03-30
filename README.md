# OpenAegis: Enterprise Agent Orchestration and Trust Platform

![OpenAegis Logo](docs/assets/branding/OpenAegisLogo.png)

OpenAegis is an open-source control layer for enterprise AI agents in regulated environments.

In plain English: the model can suggest work, but OpenAegis decides what is allowed, what must be approved, and what must be recorded as evidence.

## Why Use OpenAegis

OpenAegis is built for organizations where data leakage is a business and compliance failure, not just a bug.

| Option | Good at | Gap in regulated enterprise use | OpenAegis advantage |
| --- | --- | --- | --- |
| Generic agent frameworks | Fast prototyping | Usually weak policy, approvals, and audit replay | Policy enforced outside model + evidence chain |
| Vendor-specific copilots | Convenience | Vendor lock-in and limited control portability | Vendor-neutral model broker |
| DIY scripts | Custom logic | Hard to prove safety and control coverage | Built-in approvals, audit, incidents, simulation |
| OpenAegis | Controlled automation | Early-stage project, expanding coverage | Security-first defaults and executable proof |

## Core Value (What Is Different)

- Policy and approvals are enforced outside the model.
- High-risk live actions can be blocked pending human approval.
- Security and compliance teams get evidence IDs for replay and review.
- Sensitive routing can require zero-retention providers.
- Multi-tenant context is explicit and carried across requests.
- Simulation mode exists before live execution.

## How Policy Configuration Works

OpenAegis now includes a guided **Policy Studio** in the Security Console.

1. Edit beginner-safe controls with plain-language explanations.
2. Run **Preview Impact** to see `ALLOW / REQUIRE_APPROVAL / DENY` changes.
3. Review warnings before saving.
4. Use **LLM Copilot** to review and suggest safer settings.
5. Apply the policy profile (break-glass fields are required for blocking-risk changes).

See detailed guide: [docs/policy-studio.md](docs/policy-studio.md)

## Pilot Use Case (Live)

The included pilot demonstrates a **Hospital Discharge Readiness Assistant**:

1. Read patient context from FHIR + SQL connectors.
2. Route model inference based on sensitivity policy.
3. Block high-risk outbound follow-up actions pending human approval.
4. Capture immutable audit/evidence for every major action.

## Proof Map

| Claim | Where it is proven |
| --- | --- |
| Policy gates enforced outside model | `backend/services/api-gateway/src/index.test.ts` |
| High-risk live approval gating | `backend/services/api-gateway/src/index.test.ts` |
| Break-glass required for blocking policy downgrades | `backend/services/api-gateway/src/index.test.ts` |
| Copilot guidance for policy edits | `/v1/policies/profile/copilot` + Security Console |
| End-to-end pilot still operational | `npm run smoke:pilot` |
| Commercial evidence output | `docs/assets/demo/commercial-proof-report.json` |

## Screenshots

All screenshots are generated from live route interactions:

- KPI Dashboard: `docs/assets/screenshots/commercial-dashboard.png`
- Commercial Readiness: `docs/assets/screenshots/commercial-readiness.png`
- Security Console (Policy Studio): `docs/assets/screenshots/commercial-security.png`
- Approval Inbox: `docs/assets/screenshots/commercial-approvals.png`
- Incident Review Explorer: `docs/assets/screenshots/commercial-incidents.png`
- Audit Explorer: `docs/assets/screenshots/commercial-audit.png`
- Workflow Designer: `docs/assets/screenshots/commercial-workflow.png`
- Simulation Lab: `docs/assets/screenshots/commercial-simulation.png`
- Admin Console: `docs/assets/screenshots/commercial-admin.png`

## Quick Start

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run smoke:pilot
```

Run pilot demo output:

```bash
node tools/scripts/pilot-demo.mjs
```

Capture screenshots:

```bash
npm run screenshots:commercial
```

## Production Readiness Gate

Use these checks before a release candidate is promoted:

```bash
npm run typecheck
npm run build
npm run test
npm run smoke:pilot
npm run proof:commercial
npm run load:commercial
npm run chaos:commercial
npm run readiness:gate
```

Expected pass results:

- `npm run typecheck` exits 0
- `npm run build` exits 0
- `npm run test` exits 0
- `npm run smoke:pilot` exits 0 and refreshes the pilot evidence bundle
- `npm run proof:commercial` exits 0 and writes `docs/assets/demo/commercial-proof-report.json`
- `npm run load:commercial` exits 0 and writes `docs/assets/demo/load-test-report.json`
- `npm run chaos:commercial` exits 0 and writes `docs/assets/demo/chaos-report.json`
- `npm run readiness:gate` exits 0, writes `docs/assets/demo/readiness-gate-report.json`, and enforces >= 98%

Expected proof report fields:

- `summary.status = PASS`
- `summary.failedClaims = 0`
- `summary.scorePercent = 100`
- readiness gate `summary.status = PASS`
- readiness gate `summary.scorePercent >= 98`

If any one of those checks fails, the release is a no-go.

## Documentation Map

- [Platform blueprint](docs/openaegis-blueprint.md)
- [Commercial readiness](docs/commercial/COMMERCIAL-READINESS.md)
- [Hospital production gate](docs/readiness/HOSPITAL-PRODUCTION-GATE.md)
- [SRE runbook](docs/readiness/SRE-RUNBOOK.md)
- [Hardening controls matrix](docs/security/HARDENING-CONTROLS-MATRIX.md)
- [Policy Studio guide](docs/policy-studio.md)
- [Pilot runbook](docs/pilot/PILOT-RUNBOOK.md)
- [Smoke and pilot report](docs/tests/SMOKE-AND-PILOT-TEST-REPORT.md)
- [Operator manual](docs/manual/OpenAegis-OPERATOR-MANUAL.md)
- [Training manual](docs/manual/OpenAegis-TRAINING-MANUAL.md)
- [FAQ](docs/manual/OpenAegis-FAQ.md)
- [Setup support guide](docs/manual/OpenAegis-SETUP-SUPPORT-GUIDE.md)
- [Top-20 language packs](docs/i18n/README.md)

## Build Status

Validated in this repository:

- `npm run typecheck` passes
- `npm run test` passes
- `npm run build` passes
- `npm run smoke:pilot` passes

## Contributing

OpenAegis is early and evolving. Contributions are welcome for runtime hardening, connectors, policy packs, observability, and localization quality.
