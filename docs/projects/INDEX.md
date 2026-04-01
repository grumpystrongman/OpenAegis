# OpenAegis Project Pack Index

OpenAegis is not a chatbot demo. It is a control plane for running AI agents safely inside regulated enterprises.

This index is the fast path for evaluators:

1. Read the why section below.
2. Open one of the five pack playbooks.
3. Follow the setup checklist.
4. Apply the policy baseline.
5. Run the scenarios.
6. Review the dashboard and audit evidence.

## Why OpenAegis

OpenAegis is useful when a team wants AI to do real work, but cannot accept unsafe defaults.
It controls action, not just output.

What makes it different:

- Policy is enforced outside the model.
- High-risk live actions require human approval.
- Sensitive data can be denied, redacted, or routed to zero-retention models.
- Every major action has an evidence trail.
- The same workflow can be tested in simulation before live use.
- The platform is designed for tenants, roles, approvals, and audits from the start.

If you want a longer buyer-facing explanation, see [docs/commercial/WHY-OPENAEGIS.md](../commercial/WHY-OPENAEGIS.md).

## How To Use These Guides

Each playbook contains:

- who the pack is for
- what settings must be configured
- what policies must be on
- where the human approval happens
- three daily-use scenarios
- what the dashboard should show
- how to troubleshoot common mistakes

## Pack Guides

- [Project 01 - SecOps Runtime Guard](./PROJECT-01-SECOPS-RUNTIME-GUARD.md)
- [Project 02 - Revenue Cycle Copilot](./PROJECT-02-REVENUE-CYCLE-COPILOT.md)
- [Project 03 - Supply Chain Resilience](./PROJECT-03-SUPPLY-CHAIN-RESILIENCE.md)
- [Project 04 - Clinical Quality Signal](./PROJECT-04-CLINICAL-QUALITY-SIGNAL.md)
- [Project 05 - Board Risk Cockpit](./PROJECT-05-BOARD-RISK-COCKPIT.md)

## Persona Dashboards Across The Platform

OpenAegis should not show the same dashboard to everyone.
Each persona needs a different operational view:

- CISO: blocked actions, policy changes, break-glass events, active incidents
- Security admin: policy drift, approval queue, redaction coverage, connector risk
- Operations lead: work queue, throughput, failures, escalation status
- Analyst: task completion, scenario outcomes, evidence completeness
- Executive: trends, business impact, exception rate, readiness score

## What A Good Demo Looks Like

A good demo is boring in the right way:

- the setup is obvious
- the policy choice is obvious
- the approval step is obvious
- the dashboard reflects the action that happened
- the audit record proves what happened

If any of those are missing, the demo is not ready.
