# OpenAegis Pilot Runbook

## Pilot Profile

- Name: Hospital Discharge Readiness Assistant
- Goal: Assist discharge planning while enforcing policy gates for high-risk actions
- Tenant: `tenant-starlight-health`
- Data sensitivity: `EPHI`

## What the Pilot Demonstrates

1. Model routing with zero-retention requirements
2. Policy decisioning (`ALLOW`, `DENY`, `REQUIRE_APPROVAL`)
3. Human approval gating before risky outbound actions
4. Immutable audit/evidence generation
5. Simulation and live execution modes

## Demo Flow

```mermaid
sequenceDiagram
    participant Clinician
    participant OpenAegis
    participant Policy
    participant Approval
    participant Model
    participant Audit

    Clinician->>OpenAegis: Start live discharge workflow
    OpenAegis->>Policy: Evaluate EPHI + high-risk action
    Policy-->>OpenAegis: REQUIRE_APPROVAL
    OpenAegis->>Approval: Create approval ticket
    Approval-->>Clinician: Approval needed
    Approver->>Approval: Approve
    OpenAegis->>Model: Run policy-approved inference
    OpenAegis->>Audit: Commit evidence envelope
    OpenAegis-->>Clinician: Completed workflow + trace
```

## Start the Pilot Locally

```bash
npm install
npm run build
npm run smoke:pilot
```

Optional explicit demo output:

```bash
node tools/scripts/pilot-demo.mjs
```

Commercial proof and screenshots:

```bash
npm run test:commercial
npm run proof:commercial
npm run screenshots:commercial
```

## Pilot UI Walkthrough

1. Open the console at `http://127.0.0.1:4273/setup` and click **Connect sessions**.
2. Open **Integration Hub** and use **Load example config** + **Test connection + policy** for one integration.
3. Open **Identity & Access** and verify user roles and assurance levels.
4. Open **Business KPI Dashboard** and run one simulation pass.
5. Run **Run live workflow** from dashboard or simulation to create a pending approval.
6. Switch to the **Security** persona and open **Approval Inbox**.
7. Approve or reject the selected item and verify status/evidence update in **Audit Explorer**.
8. Open **Incident Review Explorer** to inspect derived incident records.
9. Open **Security Console -> Policy Studio**, change one control, run **Preview impact**, then run **Ask copilot**.
10. Apply the policy profile and re-run workflow to validate behavior change is intentional.

## Screenshot Gallery

- Setup Center: `docs/assets/screenshots/commercial-setup.png`
- Dashboard: `docs/assets/screenshots/commercial-dashboard.png`
- Commercial Readiness: `docs/assets/screenshots/commercial-readiness.png`
- Integration Hub: `docs/assets/screenshots/commercial-integrations.png`
- Identity & Access: `docs/assets/screenshots/commercial-identity.png`
- Admin Console: `docs/assets/screenshots/commercial-admin.png`
- Security Console: `docs/assets/screenshots/commercial-security.png`
- Workflow Designer: `docs/assets/screenshots/commercial-workflow.png`
- Approval Inbox: `docs/assets/screenshots/commercial-approvals.png`
- Incident Review: `docs/assets/screenshots/commercial-incidents.png`
- Audit Explorer: `docs/assets/screenshots/commercial-audit.png`
- Simulation Lab: `docs/assets/screenshots/commercial-simulation.png`

## Demo Artifact

- Machine-readable report: `docs/assets/demo/pilot-demo-output.json`

## Success Criteria

- Live run blocks pending approval
- Approval changes run state to completed
- Audit log includes workflow + approval events
- Evidence references are present in audit output

