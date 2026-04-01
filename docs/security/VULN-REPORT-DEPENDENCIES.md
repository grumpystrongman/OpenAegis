# Dependency and Secrets Risk Scan

Generated at: 2026-04-01T14:53:30.591Z
Repository root: `C:/Users/grump/EAOS`

## Scope
- Full dependency-tree audit
- Production-only dependency audit
- Workspace manifest lifecycle hooks, lockfile install scripts, and accepted transitive install-script packages
- Executable scripts and Dockerfiles that call `npm install` with default lifecycle execution
- Hardcoded secret-like literals and credential patterns

## Executed Commands
```text
npm run vuln:dependencies
```

## Output Summary
| Check | Status | Details |
| --- | --- | --- |
| Full dependency audit | PASS | dependencies=127, vulnerabilities=0, critical=0, high=0, moderate=0, low=0, info=0 |
| Production dependency audit | PASS | dependencies=127, vulnerabilities=0, critical=0, high=0, moderate=0, low=0, info=0 |
| Lifecycle hooks | PASS | 0 manifest hooks found |
| Dependency install scripts | ACCEPTED | 3 accepted transitive install-script packages |
| npm install defaults | PASS | 0 executable files use default install behavior |
| Secret-like patterns | PASS | 0 findings |

## Dependency Audit Details
- Full audit exit code: 0
- Production audit exit code: 0
- Full audit vulnerabilities: critical=0, high=0, moderate=0, low=0, info=0, total=0
- Production audit vulnerabilities: critical=0, high=0, moderate=0, low=0, info=0, total=0

## Script and Lockfile Risks
- No script-default risks found.

## Accepted Dependency Install Scripts
- These packages retain install scripts by design and are accepted because the build now uses `npm ci` rather than default `npm install`.
- package-lock entry `node_modules/esbuild` hasInstallScript=true
- package-lock entry `node_modules/fsevents` hasInstallScript=true (optional)
- package-lock entry `node_modules/playwright/node_modules/fsevents` hasInstallScript=true (optional)

## Secret Scan Details
- No hardcoded secret-like literals were found in the scanned source and config files.

## Machine-Readable Output
Run `npm run vuln:dependencies` to emit the JSON report on stdout and refresh this markdown artifact.

## Status
Overall scan result: **PASS**
