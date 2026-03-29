---
title: EAOS Pilot Overview
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-03-29T20:33:10.365Z'
updatedAt: '2026-03-29T20:33:10.365Z'
---
## Raw Concept
**Task:**
Document EAOS Pilot architecture and workflow

**Files:**
- backend/services/api-gateway/src/index.ts
- frontend/apps/admin-console/src/app/App.tsx
- docs/pilot/PILOT-RUNBOOK.md
- docs/tests/SMOKE-AND-PILOT-TEST-REPORT.md
- tools/scripts/pilot-demo.mjs

**Flow:**
Clinician start -> Policy evaluation (REQUIRE_APPROVAL) -> Approval -> Model inference -> Audit logging

**Timestamp:** 2026-03-29

## Narrative
### Structure
Pilot covers backend control flow, admin console, and comprehensive documentation.

### Dependencies
Requires tenant-starlight-health, API Gateway, and approved workflow definitions.

### Highlights
Demo sequence automates login, live discharge workflow, approval, and audit verification. Smoke/Pilot tests passed.

### Rules
REQUIRE_APPROVAL enforced for high-risk/live workflows.

## Facts
- **api_gateway_port**: API Gateway runs on port 3000 [project]
- **auth_token_format**: Auth expects demo-token-{userId} [convention]
- **pilot_tenant**: Tenant is tenant-starlight-health [project]
