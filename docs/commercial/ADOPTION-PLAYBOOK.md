# OpenAegis Adoption Playbook

This is the execution plan to drive real usage now, with concrete commands and measurable gates.

## 1) Launch a 14-Day Trust Proof Challenge

```bash
npm install
npm run challenge:launch
```

Challenge assets:

- `docs/challenge/TRUST-PROOF-CHALLENGE-14-DAY.md`
- `docs/challenge/TRUST-PROOF-SCORECARD.csv`
- `docs/assets/challenge/trust-proof-challenge-launch.json`

Success signal:

- 3/3 trust examples pass and challenge launch report is `PASS`.

## 2) Publish a Security Evidence Pack for CTO/CISO

```bash
npm run evidence:security-pack
```

Primary outputs:

- `docs/assets/security-evidence-pack/latest/EXECUTIVE-SUMMARY.md`
- `docs/assets/security-evidence-pack/latest/manifest.json`

Success signal:

- `manifest.status = PASS` and checksums are present for every required artifact.

## 3) Offer One-Command Local Pilot

```bash
npm run pilot:local
```

What it runs:

- readiness gate
- design-partner KPI generation
- security evidence-pack publication

Success signal:

- local pilot summary reports `PASS`.

## 4) Run 3 Design-Partner Pilots with KPI Gates

```bash
npm run pilot:design-partners
```

Pilot tracks:

- hospital operations
- finance operations
- secops containment

KPI report:

- `docs/assets/demo/design-partner-kpis.json`

Required KPI thresholds:

- approval latency <= 1500 ms
- blocked risky actions >= 3 (global)
- audit completeness >= 98%

## 5) Monetization and Commercial Motion

Keep the AGPL core open while monetizing:

- commercial license for closed-source deployment rights
- enterprise support tiers
- compliance evidence support and architecture reviews
- premium connectors and managed deployment options

See:

- `LICENSE`
- `LICENSE-COMMERCIAL.md`
- `docs/commercial/LICENSING.md`
