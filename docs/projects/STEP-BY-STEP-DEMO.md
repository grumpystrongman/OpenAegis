# OpenAegis Real-World Demo Walkthrough

This guide is intentionally simple. It is designed so a non-expert evaluator can run a complete OpenAegis demo with confidence.

## What You Will Prove

- OpenAegis controls risky actions before model/tool execution.
- High-risk live actions require human approval.
- Every major step produces auditable evidence.
- Policy changes are role-gated and versioned.

## Before You Start

1. Start the stack.
2. Open `http://127.0.0.1:4273/projects`.
3. Click `Connect evaluator identities`.

## Demo Flow (Use Any Pack)

1. Pick a project pack from the left panel.
2. Review `Seeded business data` and confirm rows are preloaded.
3. Review `Policy outcomes (live)` to see scenario decisions (`ALLOW`, `REQUIRE_APPROVAL`, `DENY`).
4. Click `Apply secure preset` (security role required).
5. Click `Run simulation`.
6. Click `Run live`.
7. Go to `Approval Inbox` and approve the pending request.
8. Return to the pack and verify latest execution is completed with evidence ID.

## Suggested Pack Sequence

1. `SecOps Runtime Guard`: easiest way to show deny + approval behavior.
2. `Revenue Cycle Copilot`: demonstrates PHI-safe routing and finance writeback governance.
3. `Clinical Quality Signal`: demonstrates ePHI controls and human-gated notifications.

## What to Show During a Live Demo

- The same action has different outcomes in simulation vs live mode.
- Unsafe scenarios are blocked with explicit reason codes.
- Secure baseline can be applied quickly from the UI.
- Every run produces execution ID, approval ID (when required), and evidence ID.

## Troubleshooting

- If packs are empty: reconnect evaluator identities and refresh.
- If `Apply secure preset` is disabled: use a security/admin session.
- If live run does not progress: approve the request in `Approval Inbox`.
- If decisions look stale: reload the project pack experience data by refreshing workspace.
