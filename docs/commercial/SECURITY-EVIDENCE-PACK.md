# OpenAegis Security Evidence Pack

This is the CTO/CISO-facing artifact bundle for security and compliance review.

## Generate

```bash
npm run evidence:security-pack
```

Generated outputs:

- `docs/assets/security-evidence-pack/latest/EXECUTIVE-SUMMARY.md`
- `docs/assets/security-evidence-pack/latest/manifest.json`
- `docs/assets/security-evidence-pack/latest/demo/*.json`
- `docs/assets/security-evidence-pack/latest/readiness/*.md`

## What Is Included

- readiness gate results
- trust-layer proof results
- codebase line-audit results
- commercial proof and audit reports
- load and chaos reports
- design-partner KPI report
- threat model and data governance docs
- hardening controls matrix

## Integrity

`manifest.json` contains SHA-256 checksums and file sizes for all required files.

## Pass Criteria

- `manifest.status = PASS`
- readiness gate score >= 98
- trust-layer proof status = PASS
- design-partner KPI status = PASS

If one fails, the package should be treated as non-releaseable evidence.
