---
children_hash: 6d8e4368892bd889612723437d10e0581313131f737eacd7b5dcd26283113ea0
compression_ratio: 0.7714808043875686
condensation_order: 3
covers: [architecture/_index.md]
covers_token_total: 547
summary_level: d3
token_count: 422
type: summary
---
### EAOS Architectural Summary (Level 3)

The EAOS platform functions as a vendor-neutral orchestration framework for regulated environments, organized into five core planes: Experience, Control, Secure Agent Runtime, Data, and Trust.

**1. Architecture & Infrastructure (Ref: eaos_overview)**
- Functional Layers: Orchestrates across five distinct planes to ensure modularity and compliance.
- Infrastructure Stack: Relies on PostgreSQL (storage), Kafka/NATS (messaging), Redis (caching), and Minio (object storage).
- Operational Principles: Enforces zero-retention policies for sensitive data, default-deny egress rules, and dual-approval break-glass protocols for high-privilege operations.

**2. Pilot Workflow & Implementation (Ref: eaos_pilot)**
- Workflow Lifecycle: Clinician Initiation → Policy Evaluation (`REQUIRE_APPROVAL`) → Approval → Inference → Audit.
- Key Assets:
    - API Gateway: `backend/services/api-gateway/src/index.ts` (port 3000).
    - Admin Interface: `frontend/apps/admin-console/src/app/App.tsx`.
    - Automation: `tools/scripts/pilot-demo.mjs`.
- Tenant Constraints: `tenant-starlight-health` mandates `REQUIRE_APPROVAL` for high-risk operations; authentication utilizes `demo-token-{userId}` formatting.

**3. Security & Governance Standards (Ref: eaos_security)**
- Zero-Trust Model: Implements multi-tenant isolation, OIDC/SAML identity integration, and mandatory TLS 1.3 transit encryption.
- Data Security: Employs envelope encryption at rest; PHI/ePHI exposure constitutes a system-level failure.
- Compliance: Mandates 6+ year retention for ePHI. Consult `docs/data-governance.md` and `docs/threat-model.md` for extended regulatory specifications.