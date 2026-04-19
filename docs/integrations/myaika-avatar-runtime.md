# MyAika Avatar Runtime Policy Integration

Date: 2026-04-12

## Purpose
This document defines how MyAika avatar operations map to policy enforcement so the avatar stack remains production-safe.

## Runtime Surface (MyAika)
- `POST /api/aika/avatar/runtime/initialize`
- `POST /api/aika/avatar/runtime/interaction/user-input`
- `POST /api/aika/avatar/runtime/interaction/agent-output`
- `POST /api/aika/avatar/runtime/interaction/interrupt`
- `POST /api/aika/avatar/runtime/lipsync/preview`
- `GET /api/aika/avatar/runtime/status`

## Asset Management Surface (MyAika)
- `POST /api/aika/avatar/import`
- `POST /api/aika/avatar/refresh`
- `POST /api/aika/avatar/core`

## Policy Mapping
The MyAika server uses its policy engine (`executeAction`) for avatar file operations:
- Avatar model import: `actionType = file.write`
- Avatar manifest refresh: `actionType = file.write`
- Live2D core upload: `actionType = file.write`

These actions include `resourceRefs` so protected path checks and risk scoring are applied before write operations.

## OpenAegis Alignment
OpenAegis can consume the same event model by ingesting:
- `action_type`
- `risk_score`
- `decision` (`allow`, `require_approval`, `deny`)
- `resource_refs`
- redacted payload metadata

## Recommendation
For centralized governance, route MyAika avatar audit events into OpenAegis evidence pipelines and review them with standard policy profile controls.