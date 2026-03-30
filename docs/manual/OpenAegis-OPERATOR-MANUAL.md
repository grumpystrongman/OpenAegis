# OpenAegis Operator Manual

## 1. What This Platform Is

OpenAegis is the control system around enterprise AI agents.

It is not a chatbot UI and not an autonomous agent playground.

Its job is to make sure every important action is:

- checked by policy
- blocked if unsafe
- approval-gated when high risk
- logged with evidence for later review

## 2. Core Terms (Simple)

- Tenant: one organization boundary.
- Workflow: a sequence of controlled steps.
- Policy decision: `ALLOW`, `REQUIRE_APPROVAL`, or `DENY`.
- Approval: human decision required for risky live actions.
- Evidence ID: immutable reference used for audit and replay.
- Incident: a tracked security or control failure signal.

## 3. Daily Operator Responsibilities

1. Check dashboard health and blocked counts.
2. Review pending approvals.
3. Review new incidents.
4. Confirm policy profile is still safe.
5. Confirm audit stream is active.

## 4. Policy Operations

Use **Security Console -> Policy Studio** for policy changes.

Safe flow:

1. Change controls.
2. Run Preview Impact.
3. Read warnings.
4. Ask Copilot when needed.
5. Apply policy.

Rules:

- Do not apply risky changes without preview.
- Do not bypass blocking warnings without break-glass documentation.
- Keep zero-retention safeguards on for PHI/EPHI.

## 5. Secure Operating Rules

- Never disable secret-data deny in normal operation.
- Never route PHI/EPHI externally without zero-retention safeguards.
- Never skip approval requirements for high-risk live actions unless break-glass is approved.
- Never delete or tamper with evidence records.
- Always use least-privilege roles for operators and connectors.

## 6. Incident Response Playbook

1. Detect: identify blocked action or failure signal.
2. Contain: pause risky workflows or activate kill switch.
3. Investigate: inspect audit events and evidence IDs.
4. Replay: run simulation/review timeline from evidence chain.
5. Report: create incident package for security/compliance.

## 7. Compliance Evidence Exports

For each case, include:

- initiator identity
- policy decision(s)
- approval record(s)
- tool/model route metadata
- audit event chain
- final disposition

Primary sources:

- Audit Explorer
- Incident Review Explorer
- `docs/assets/demo/commercial-proof-report.json`

## 8. What Never to Do

- Do not treat model output as policy truth.
- Do not grant broad connector permissions by default.
- Do not run new live changes without simulation.
- Do not close incidents without evidence linkage.
