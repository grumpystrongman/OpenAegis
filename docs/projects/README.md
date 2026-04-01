# OpenAegis Project Demo Packs

This directory contains the five end-to-end operational playbooks used to demonstrate OpenAegis in real-world conditions.

## Start Here

- [Project Pack Index](./INDEX.md)
- [Step-by-Step Demo Walkthrough](./STEP-BY-STEP-DEMO.md)

## What This Directory Proves

- OpenAegis can control risky agent actions outside the model.
- OpenAegis can show clear settings that a non-expert can configure.
- OpenAegis can require a human in the loop when the action is risky.
- OpenAegis can connect to recognizable open-source enterprise systems.
- OpenAegis can show dashboards that match the role of the person using it.

## Reference Design Notes

- Keep the stack realistic: Kubernetes, PostgreSQL, Kafka, Argo CD, OpenTelemetry, Prometheus, Grafana, Keycloak, Vault, Airflow, dbt, Superset, and OpenSearch are used because buyers already know them.
- Keep the controls external to the model: approvals, policy evaluation, redaction, and release gates must not depend on a prompt.
- Keep the outputs inspectable: every pack should end with logs, IDs, manifests, screenshots, and immutable evidence.
