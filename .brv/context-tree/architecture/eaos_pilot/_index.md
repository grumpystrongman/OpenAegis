---
children_hash: f3a3a756bf62c7b6f39dd65f5f7592384c887838277aa98c295d1962482af17c
compression_ratio: 0.9638157894736842
condensation_order: 1
covers: [eaos_pilot_overview.md]
covers_token_total: 304
summary_level: d1
token_count: 293
type: summary
---
# EAOS Pilot Structural Summary

The EAOS Pilot establishes the core architecture for clinical workflow automation, focusing on policy-gated inference and audit integrity.

### Workflow and Architecture
The pilot follows a sequential flow: Clinician Initiation → Policy Evaluation (`REQUIRE_APPROVAL` for high-risk operations) → Approval → Model Inference → Audit Logging.

### Key Components
*   **Gateway & Core:** `backend/services/api-gateway/src/index.ts` (port 3000) handles service routing.
*   **Interface:** `frontend/apps/admin-console/src/app/App.tsx` provides the administrative control plane.
*   **Automation:** `tools/scripts/pilot-demo.mjs` executes the end-to-end demo sequence.
*   **Documentation:** `docs/pilot/PILOT-RUNBOOK.md` and `docs/tests/SMOKE-AND-PILOT-TEST-REPORT.md` define operational procedures and validation status.

### Critical Constraints and Facts
*   **Tenant:** `tenant-starlight-health`.
*   **Security:** `REQUIRE_APPROVAL` policy is mandatory for live/high-risk workflows.
*   **Authentication:** Expected token format is `demo-token-{userId}`.

Refer to `eaos_pilot_overview.md` for full implementation details and test results.