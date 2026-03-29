---
children_hash: a530648403ebcde9d5e963c676d42bf6b797ac92143a33bf57d7bfdddfec6c0c
compression_ratio: 0.5091693635382956
condensation_order: 2
covers: [eaos_overview/_index.md, eaos_pilot/_index.md, eaos_security/_index.md]
covers_token_total: 927
summary_level: d2
token_count: 472
type: summary
---
# EAOS Structural Overview (Level 2)

This summary synthesizes the core architectural, operational, and security pillars of the EAOS platform. For detailed implementation, refer to the source entries: `eaos_overview`, `eaos_pilot`, and `eaos_security`.

### 1. Architectural Blueprint (eaos_overview)
EAOS is a vendor-neutral orchestration framework built for regulated environments. It operates across five functional layers: Experience, Control, Secure Agent Runtime, Data, and Trust Planes.
* **Infrastructure Dependencies:** PostgreSQL, Kafka/NATS, Redis, Minio.
* **Operational Principles:** Zero-retention for sensitive data, default-deny egress control, and strict break-glass protocols requiring dual-approval for high-privilege actions.

### 2. Pilot Implementation & Workflows (eaos_pilot)
The EAOS Pilot demonstrates clinical workflow automation with policy-gated integrity.
* **Workflow:** Clinician Initiation → Policy Evaluation (`REQUIRE_APPROVAL`) → Approval → Inference → Audit.
* **Core Assets:**
    * **Gateway:** `backend/services/api-gateway/src/index.ts` (port 3000).
    * **Admin Interface:** `frontend/apps/admin-console/src/app/App.tsx`.
    * **Automation Script:** `tools/scripts/pilot-demo.mjs`.
* **Constraints:** Tenant `tenant-starlight-health` requires mandatory `REQUIRE_APPROVAL` for high-risk operations; authentication tokens follow `demo-token-{userId}` format.

### 3. Security & Governance (eaos_security)
The security model enforces zero-trust through multi-tenant isolation and immutable auditing.
* **Access & Encryption:** OIDC/SAML identity integration, mandatory TLS 1.3 transit encryption, and envelope encryption at rest.
* **Compliance:** PHI/ePHI exposure is treated as a system-level failure. EPHI retention is mandated at 6+ years.
* **References:** For compliance specifics, see `docs/data-governance.md` and `docs/threat-model.md`.