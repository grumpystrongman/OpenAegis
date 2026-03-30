# OpenAegis FAQ

## What problem does OpenAegis solve?
It lets enterprises run AI workflows with policy checks, human approvals, and audit evidence.

## Is this a chatbot framework?
No. It is control-plane infrastructure for regulated agent workflows.

## Why not let the model decide policy?
Because policy must be deterministic, reviewable, and enforceable outside model behavior.

## How do I apply security policy changes?
Use Security Console -> Policy Studio. Edit controls, run Preview Impact, review warnings, then apply.

## How does OpenAegis warn me about risky changes?
Policy validation labels issues as blocking, warning, or info. Blocking downgrades require break-glass fields.

## What is break-glass in this system?
An emergency override flow requiring ticket ID, justification, and dual approver IDs.

## Can a beginner use the policy interface?
Yes. Controls include plain-language explanations, impact preview, and copilot guidance.

## What does the policy copilot do?
It reviews proposed controls, explains risk, and suggests safer values. It can run via local LLM endpoint or built-in fallback.

## What happens when an action is high risk?
By default, live high-risk actions are blocked until human approval.

## How does OpenAegis prevent leakage?
Default-deny controls, sensitivity-aware routing, approval gates, DLP requirements, and audit evidence.

## Can we use multiple model vendors?
Yes. Model routing is vendor-neutral and broker-based.

## How do we prove what happened during execution?
Use Audit Explorer and evidence IDs. You can trace policy decisions, approvals, and final outcomes.

## Is there a working pilot in this repository?
Yes. Use `npm run smoke:pilot` and `node tools/scripts/pilot-demo.mjs`.

## Where are visual demos and reports?
- `docs/assets/screenshots/`
- `docs/assets/demo/pilot-demo-output.json`
- `docs/assets/demo/commercial-proof-report.json`
