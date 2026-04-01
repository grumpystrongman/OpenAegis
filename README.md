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
- Plugin/extension arm supports OAuth, API key, service-principal, and key-pair onboarding patterns.

## Plugin and Extension Arm

OpenAegis now includes a broader plugin lifecycle through `tool-registry`:

- Catalog: `GET /v1/tools`
- Plugin instances: `GET/POST /v1/plugins/instances`
- OAuth authorization: `POST /v1/plugins/instances/{id}/authorize`
- Connection test: `POST /v1/plugins/instances/{id}/test`

Included connector families now cover AWS, Databricks, Fabric, Jira, Confluence, OpenAI, Anthropic, Google, Azure OpenAI, Airbyte, Airflow, Trino, Superset, Metabase, Grafana, Kafka, NiFi, Dagster, n8n, plus healthcare and operations connectors.

## Commercial Project Packs (5 End-to-End Scenarios)

Run the commercial showcase harness:

```bash
npm run showcase:projects
```

This validates five commercially relevant projects with live API execution:

1. SecOps Runtime Guard
2. Revenue Cycle Copilot
3. Supply Chain Resilience
4. Clinical Quality Signal
5. Board Risk Cockpit

Artifact:

- `docs/assets/demo/commercial-projects-showcase-report.json`

In the Admin Console, open `http://127.0.0.1:4273/projects` to see:

- seeded operational tables per pack
- live-evaluated policy scenario outcomes
- one-click secure baseline policy presets
- step-by-step walkthrough cards with evidence expectations

Guide: [docs/projects/STEP-BY-STEP-DEMO.md](docs/projects/STEP-BY-STEP-DEMO.md)

## How Policy Configuration Works

OpenAegis now includes a guided **Policy Studio** in the Security Console.

1. Edit beginner-safe controls with plain-language explanations.
2. Run **Preview Impact** to see `ALLOW / REQUIRE_APPROVAL / DENY` changes.
3. Run **Explain Impact** to see risk score delta and per-control safety guidance.
4. Review warnings before saving.
5. Use **LLM Copilot** to review and suggest safer settings.
6. Apply the policy profile (break-glass fields are required for blocking-risk changes).

See detailed guide: [docs/policy-studio.md](docs/policy-studio.md)

## Identity Hardening Mode

OpenAegis supports a hardened gateway auth path using auth-service introspection.

Set:

- `OPENAEGIS_AUTH_INTROSPECTION_URL`
- `OPENAEGIS_REQUIRE_INTROSPECTION=true`

Secure default:

- Insecure demo login/token mode is disabled unless explicitly enabled with `OPENAEGIS_ENABLE_INSECURE_DEMO_AUTH=true`.

In this mode, bearer tokens are introspected and write operations enforce tenant scope from token claims.

## Trust Layer Proof (3 End-to-End Examples)

Run the executable trust proof harness:

```bash
npm run proof:trust-layer
```

This runs three distinct examples:

1. Healthcare discharge orchestration (policy + approval + audit replay)
2. Finance operations guardrails (runtime blocks + idempotent retries)
3. SecOps containment (break-glass + kill-switch + immutable chain)

Artifact:

- `docs/assets/demo/trust-layer-proof-report.json`

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
| Policy impact explainability and advisor fix path | `/v1/policies/profile/explain` + Security Console |
| Copilot guidance for policy edits | `/v1/policies/profile/copilot` + Security Console |
| End-to-end pilot still operational | `npm run smoke:pilot` |
| Commercial evidence output | `docs/assets/demo/commercial-proof-report.json` |

## Screenshots

All screenshots are generated from live route interactions:

- Setup Center: `docs/assets/screenshots/commercial-setup.png`
- KPI Dashboard: `docs/assets/screenshots/commercial-dashboard.png`
- Project Packs: `docs/assets/screenshots/commercial-projects.png`
- Sandbox Proof Review: `docs/assets/screenshots/commercial-sandbox-proof.png`
- Pack Guide (SecOps Runtime Guard): `docs/assets/screenshots/commercial-project-guide-secops-runtime-guard.png`
- Pack Guide (Revenue Cycle Copilot): `docs/assets/screenshots/commercial-project-guide-revenue-cycle-copilot.png`
- Pack Guide (Supply Chain Resilience): `docs/assets/screenshots/commercial-project-guide-supply-chain-resilience.png`
- Pack Guide (Clinical Quality Signal): `docs/assets/screenshots/commercial-project-guide-clinical-quality-signal.png`
- Pack Guide (Board Risk Cockpit): `docs/assets/screenshots/commercial-project-guide-board-risk-cockpit.png`
- Commercial Readiness: `docs/assets/screenshots/commercial-readiness.png`
- Integration Hub: `docs/assets/screenshots/commercial-integrations.png`
- Identity & Access: `docs/assets/screenshots/commercial-identity.png`
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
npm run validate:test-surface
npm run security:regression
npm run proof:trust-layer
npm run sandbox:proof
npm run audit:codebase
npm run trust:pack
npm run trust:audit
npm run run:tool-registry
```

Run pilot demo output:

```bash
node tools/scripts/pilot-demo.mjs
```

Console UX starts at:

- `http://127.0.0.1:4273/setup` for guided onboarding
- `http://127.0.0.1:4273/projects` for five commercial project packs
- `http://127.0.0.1:4273/integrations` for Databricks/Fabric/Snowflake/AWS setup
- `http://127.0.0.1:4273/identity` for user and role administration

Capture screenshots:

```bash
npm run screenshots:commercial
```

Generate and verify all five live sandbox packs (Trino/Airflow/FHIR/OpenSearch/OPA/MinIO, etc.):

```bash
npm run sandbox:proof
```

One-command local pilot (readiness + KPI + security pack):

```bash
npm run pilot:local
```

Launch the 14-day trust proof challenge:

```bash
npm run challenge:launch
```

## Production Readiness Gate

Use these checks before a release candidate is promoted:

```bash
npm run typecheck
npm run build
npm run test
npm run validate:test-surface
npm run validate:infra
npm run security:regression
npm run smoke:pilot
npm run proof:commercial
npm run proof:trust-layer
npm run audit:codebase
npm run trust:pack
npm run trust:audit
npm run audit:commercial
npm run load:commercial
npm run chaos:commercial
npm run readiness:gate
```

Expected pass results:

- `npm run typecheck` exits 0
- `npm run build` exits 0
- `npm run test` exits 0
- `npm run validate:test-surface` exits 0 and verifies every workspace has executable tests
- `npm run validate:infra` exits 0 and validates Docker/Kubernetes/Helm packaging
- `npm run security:regression` exits 0 and writes `docs/assets/demo/security-regression-report.json`
- `npm run smoke:pilot` exits 0 and refreshes the pilot evidence bundle
- `npm run proof:commercial` exits 0 and writes `docs/assets/demo/commercial-proof-report.json`
- `npm run proof:trust-layer` exits 0 and writes `docs/assets/demo/trust-layer-proof-report.json`
- `npm run audit:codebase` exits 0 and writes `docs/assets/demo/codebase-line-audit-report.json`
- `npm run trust:pack` exits 0 and updates `docs/assets/enterprise-trust-pack/latest`
- `npm run trust:audit` exits 0 and writes `docs/assets/demo/enterprise-trust-pack-audit-report.json`
- `npm run audit:commercial` exits 0 and writes `docs/assets/demo/commercial-audit-report.json`
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
- [MVP plan](docs/mvp-plan.md)
- [Commercial readiness](docs/commercial/COMMERCIAL-READINESS.md)
- [Project packs value brief](docs/commercial/PROJECT-PACKS-VALUE.md)
- [Why OpenAegis](docs/commercial/WHY-OPENAEGIS.md)
- [CISO decision brief](docs/commercial/CISO-DECISION-BRIEF.md)
- [Enterprise trust pack](docs/compliance/ENTERPRISE-TRUST-PACK.md)
- [Adoption playbook](docs/commercial/ADOPTION-PLAYBOOK.md)
- [OpenClaw adoption matrix](docs/commercial/OPENCLAW-ADOPTION-MATRIX.md)
- [Security evidence pack guide](docs/commercial/SECURITY-EVIDENCE-PACK.md)
- [Licensing model](docs/commercial/LICENSING.md)
- [Trademark policy](docs/commercial/TRADEMARK-POLICY.md)
- [14-day trust proof challenge](docs/challenge/TRUST-PROOF-CHALLENGE-14-DAY.md)
- [Design-partner pilots](docs/pilot/DESIGN-PARTNER-PILOTS.md)
- [Commercial project packs](docs/projects/README.md)
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

## License

OpenAegis uses dual licensing:

- AGPL-3.0-only: [LICENSE](LICENSE)
- Commercial terms: [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)

## Build Status

Validated in this repository:

- `npm run typecheck` passes
- `npm run test` passes
- `npm run build` passes
- `npm run smoke:pilot` passes

## Contributing

OpenAegis is early and evolving. Contributions are welcome for runtime hardening, connectors, policy packs, observability, and localization quality.
