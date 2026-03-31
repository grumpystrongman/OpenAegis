import { useEffect, useMemo, useState } from "react";
import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, KeyValueList, Panel, PageHeader } from "../ui.js";

const REQUIRED_INPUTS: Record<"databricks" | "fabric" | "snowflake" | "aws", string[]> = {
  databricks: ["workspaceUrl", "catalog", "servicePrincipal", "token"],
  fabric: ["tenantId", "workspaceId", "lakehouse", "clientId", "clientSecret"],
  snowflake: ["account", "warehouse", "database", "schema", "role", "privateKey"],
  aws: ["accountId", "region", "roleArn", "externalId", "kmsKeyArn"]
};

const FIELD_META: Record<string, { label: string; secret: boolean; placeholder?: string }> = {
  workspaceUrl: { label: "Workspace URL", secret: false },
  catalog: { label: "Catalog", secret: false },
  servicePrincipal: { label: "Service principal", secret: false },
  token: { label: "Broker secret ref", secret: true, placeholder: "vault://secret/databricks/token" },
  tenantId: { label: "Tenant ID", secret: false },
  workspaceId: { label: "Workspace ID", secret: false },
  lakehouse: { label: "Lakehouse", secret: false },
  clientId: { label: "Client ID", secret: false },
  clientSecret: { label: "Broker secret ref", secret: true, placeholder: "vault://secret/fabric/client-secret" },
  account: { label: "Account", secret: false },
  warehouse: { label: "Warehouse", secret: false },
  database: { label: "Database", secret: false },
  schema: { label: "Schema", secret: false },
  role: { label: "Role", secret: false },
  privateKey: { label: "Broker secret ref", secret: true, placeholder: "vault://secret/snowflake/private-key" },
  accountId: { label: "Account ID", secret: false },
  region: { label: "Region", secret: false },
  roleArn: { label: "Role ARN", secret: false },
  externalId: { label: "External ID", secret: true, placeholder: "vault://secret/aws/external-id" },
  kmsKeyArn: { label: "KMS key ARN", secret: false }
};

const SECRET_FIELDS = new Set(
  Object.entries(FIELD_META)
    .filter(([, meta]) => meta.secret)
    .map(([field]) => field)
);

const toTone = (status: string) =>
  status === "verified"
    ? "success"
    : status === "error"
      ? "danger"
      : status === "verifying"
        ? "warning"
        : "default";

export const IntegrationHubPage = () => {
  const integrations = usePilotWorkspace((state) => state.integrations);
  const clinicianSession = usePilotWorkspace((state) => state.clinicianSession);
  const securitySession = usePilotWorkspace((state) => state.securitySession);
  const configureIntegration = usePilotWorkspace((state) => state.configureIntegration);
  const verifyIntegration = usePilotWorkspace((state) => state.verifyIntegration);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const [selected, setSelected] = useState<"databricks" | "fabric" | "snowflake" | "aws">("databricks");
  const [draftConfig, setDraftConfig] = useState<Record<string, string>>({});
  const [revealFields, setRevealFields] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const current = integrations.find((integration) => integration.integrationId === selected);
  const blueprint = pilotWorkspaceBlueprint.integrations.find((integration) => integration.integrationId === selected);
  const requiredFields = REQUIRED_INPUTS[selected];
  const hasSessions = Boolean(clinicianSession && securitySession);

  const defaults = useMemo(
    () =>
      ({
        databricks: {
          workspaceUrl: "https://dbc-demo.cloud.databricks.com",
          catalog: "clinical_prod",
          servicePrincipal: "spn-openaegis-dbx",
          token: "vault://secret/databricks/token"
        },
        fabric: {
          tenantId: "tenant-demo",
          workspaceId: "fabric-workspace-001",
          lakehouse: "patient-operations",
          clientId: "fabric-app-client-id",
          clientSecret: "vault://secret/fabric/client-secret"
        },
        snowflake: {
          account: "starlight-health.us-east-1",
          warehouse: "WH_ANALYTICS_RO",
          database: "CAREOPS",
          schema: "PUBLIC",
          role: "ROLE_AGENT_READONLY",
          privateKey: "vault://secret/snowflake/private-key"
        },
        aws: {
          accountId: "123456789012",
          region: "us-east-1",
          roleArn: "arn:aws:iam::123456789012:role/OpenAegisRuntimeRole",
          externalId: "vault://secret/aws/external-id",
          kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/demo-kms-key"
        }
      })[selected],
    [selected]
  );

  useEffect(() => {
    if (!current) return;
    const seededDraft = requiredFields.reduce<Record<string, string>>(
      (acc, field) => ({
        ...acc,
        [field]: current.config[field] ?? ""
      }),
      {}
    );
    setDraftConfig(seededDraft);
    setRevealFields({});
    setNotice(null);
  }, [current, requiredFields, selected]);

  const hasUnsavedChanges = useMemo(() => {
    if (!current) return false;
    return requiredFields.some((field) => (current.config[field] ?? "") !== (draftConfig[field] ?? ""));
  }, [current, draftConfig, requiredFields]);

  const missingFields = requiredFields.filter((field) => !(current?.config[field] ?? "").trim());
  const invalidSecretRefs = requiredFields.filter((field) => {
    if (!SECRET_FIELDS.has(field)) return false;
    const value = (current?.config[field] ?? "").trim();
    return value.length > 0 && !value.startsWith("vault://");
  });

  const verificationChecks = [
    {
      label: "Identity context",
      result: hasSessions ? "pass" : "fail",
      detail: hasSessions ? "Evaluator identities connected." : "Connect clinician and security identities first."
    },
    {
      label: "Required fields",
      result: missingFields.length === 0 ? "pass" : "fail",
      detail: missingFields.length === 0 ? "All required fields are present." : `Missing: ${missingFields.join(", ")}`
    },
    {
      label: "Secrets broker refs",
      result: invalidSecretRefs.length === 0 ? "pass" : "fail",
      detail:
        invalidSecretRefs.length === 0
          ? "Secret fields use broker references."
          : `Use vault:// references for: ${invalidSecretRefs.join(", ")}`
    },
    {
      label: "Policy profile",
      result: blueprint?.defaultPolicyProfile ? "pass" : "fail",
      detail: blueprint?.defaultPolicyProfile
        ? `Default profile: ${blueprint.defaultPolicyProfile}`
        : "No policy profile attached."
    },
    {
      label: "Connectivity test",
      result: current?.status === "verified" ? "pass" : current?.status === "error" ? "fail" : "pending",
      detail:
        current?.status === "verified"
          ? `Verified at ${new Date(current.verifiedAt ?? "").toLocaleString()}`
          : current?.status === "error"
            ? current.lastError ?? "Verification failed."
            : "Run Test connection + policy."
    }
  ] as const;

  const saveConfiguration = (values: Record<string, string>) => {
    const missingDraft = requiredFields.filter((field) => !(values[field] ?? "").trim());
    if (missingDraft.length > 0) {
      setNotice(`Complete required fields before saving: ${missingDraft.join(", ")}`);
      return false;
    }

    const invalidDraftSecretRefs = requiredFields.filter((field) => {
      if (!SECRET_FIELDS.has(field)) return false;
      const value = (values[field] ?? "").trim();
      return !value.startsWith("vault://");
    });
    if (invalidDraftSecretRefs.length > 0) {
      setNotice(`Secret fields must use vault:// references: ${invalidDraftSecretRefs.join(", ")}`);
      return false;
    }

    configureIntegration(selected, values);
    setNotice("Configuration saved. Run Test connection + policy.");
    return true;
  };

  const handleVerify = async () => {
    if (hasUnsavedChanges) {
      setNotice("Save configuration changes before verification.");
      return;
    }
    setNotice(null);
    await verifyIntegration(selected);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Enterprise connectivity"
        title="Integration Hub"
        subtitle="Clean setup for Databricks, Fabric, Snowflake, and AWS with explicit validation status."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              Connect evaluator identities
            </button>
          </>
        }
      />

      {notice ? <div className="banner info">{notice}</div> : null}

      <section className="split-grid">
        <Panel title="Integration catalog" subtitle="Pick a platform and complete its required configuration fields.">
          <div className="scenario-list">
            {pilotWorkspaceBlueprint.integrations.map((integration) => {
              const state = integrations.find((item) => item.integrationId === integration.integrationId);
              return (
                <button
                  key={integration.integrationId}
                  type="button"
                  className={selected === integration.integrationId ? "scenario-card active" : "scenario-card"}
                  onClick={() => setSelected(integration.integrationId)}
                >
                  <strong>{integration.name}</strong>
                  <p>{integration.purpose}</p>
                  <div className="pill-row">
                    <Badge tone="info">{integration.category}</Badge>
                    <Badge tone={toTone(state?.status ?? "not_configured")}>{state?.status ?? "not_configured"}</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Setup checklist" subtitle="No hidden magic. Every field and policy dependency is explicit.">
          {blueprint && current ? (
            <div className="stack">
              <KeyValueList
                items={[
                  { label: "Selected integration", value: blueprint.name },
                  { label: "Default policy profile", value: blueprint.defaultPolicyProfile },
                  { label: "Configured at", value: current.configuredAt ?? "not configured" },
                  { label: "Verified at", value: current.verifiedAt ?? "not verified" }
                ]}
              />
              <div className="stack">
                {requiredFields.map((field) => {
                  const meta = FIELD_META[field] ?? { label: field, secret: false };
                  const isRevealed = revealFields[field] ?? false;
                  return (
                    <label key={field} className="form-field">
                      <span>{meta.label}</span>
                      <div className="field-with-action">
                        <input
                          type={meta.secret && !isRevealed ? "password" : "text"}
                          value={draftConfig[field] ?? ""}
                          placeholder={meta.placeholder}
                          onChange={(event) =>
                            setDraftConfig((previous) => ({
                              ...previous,
                              [field]: event.target.value
                            }))
                          }
                        />
                        {meta.secret ? (
                          <button
                            type="button"
                            aria-pressed={isRevealed}
                            aria-label={`${isRevealed ? "Hide" : "Reveal"} ${meta.label}`}
                            onClick={() =>
                              setRevealFields((previous) => ({
                                ...previous,
                                [field]: !isRevealed
                              }))
                            }
                          >
                            {isRevealed ? "Hide" : "Reveal"}
                          </button>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="pill-row">
                <button
                  type="button"
                  onClick={() => {
                    setDraftConfig(defaults);
                    setNotice("Example values loaded in editor. Save before verification.");
                  }}
                >
                  Load example config
                </button>
                <button type="button" onClick={() => saveConfiguration(draftConfig)} disabled={!hasUnsavedChanges}>
                  Save config
                </button>
                <button type="button" className="primary" onClick={() => void handleVerify()} disabled={hasUnsavedChanges}>
                  Test connection + policy
                </button>
              </div>
              {hasUnsavedChanges ? (
                <div className="warning-copy">You have unsaved changes. Save config before running verification.</div>
              ) : null}
              {current.lastError ? <div className="banner error">{current.lastError}</div> : null}
            </div>
          ) : null}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Trust notes" subtitle="Security controls expected by CISOs before enabling production traffic.">
          <div className="stack">
            {(blueprint?.trustNotes ?? []).map((note) => (
              <div key={note} className="hint-row">
                <Badge tone="warning">Control</Badge>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Verification checks" subtitle="Structured preflight feedback for setup confidence.">
          <div className="stack">
            {verificationChecks.map((check) => (
              <article key={check.label} className="policy-impact-row">
                <div className="policy-impact-head">
                  <strong>{check.label}</strong>
                  <Badge
                    tone={check.result === "pass" ? "success" : check.result === "fail" ? "danger" : "warning"}
                  >
                    {check.result}
                  </Badge>
                </div>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Verification summary</h3>
            <p className="panel-subtitle">Current connection state across all four strategic integrations.</p>
          </div>
        </div>
        <div className="stack">
          {integrations.map((integration) => (
            <article key={integration.integrationId} className="policy-impact-row">
              <div className="policy-impact-head">
                <strong>{integration.name}</strong>
                <Badge tone={toTone(integration.status)}>{integration.status}</Badge>
              </div>
              <p>
                {integration.verifiedAt
                  ? `Verified at ${new Date(integration.verifiedAt).toLocaleString()}`
                  : "Not verified yet"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
