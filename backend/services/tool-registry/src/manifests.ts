export type ToolAction = "READ" | "WRITE" | "EXECUTE";
export type ToolManifestStatus = "draft" | "published";
export type ConnectorTrustTier = "tier-1" | "tier-2" | "tier-3" | "tier-4";
export type PluginAuthMethod = "oauth2" | "api_key" | "service_principal" | "key_pair";
export type PluginInstanceStatus = "pending_authorization" | "ready" | "authorized" | "healthy" | "unhealthy";

export interface ToolManifestRecord {
  toolId: string;
  displayName: string;
  connectorType:
    | "microsoft-fabric"
    | "power-bi"
    | "sql"
    | "fhir"
    | "hl7"
    | "sharepoint"
    | "email"
    | "ticketing"
    | "project"
    | "aws"
    | "databricks"
    | "fabric"
    | "jira"
    | "confluence"
    | "openai"
    | "anthropic"
    | "google"
    | "azure-openai"
    | "airbyte"
    | "airflow"
    | "trino"
    | "superset"
    | "metabase"
    | "grafana"
    | "kafka"
    | "nifi"
    | "dagster"
    | "n8n";
  description: string;
  version: string;
  trustTier: ConnectorTrustTier;
  allowedActions: ToolAction[];
  authMethods: PluginAuthMethod[];
  permissionScopes: string[];
  outboundDomains: string[];
  rateLimitPerMinute: number;
  idempotent: boolean;
  mockModeSupported: boolean;
  signature: string;
  signedBy: string;
  status: ToolManifestStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface PluginInstanceAuthRefs {
  apiKeyRef?: string;
  clientSecretRef?: string;
  privateKeyRef?: string;
  certificateRef?: string;
  privateKeyPasswordRef?: string;
  refreshTokenRef?: string;
  accessTokenRef?: string;
  brokerRef?: string;
  authorizationBrokerRef?: string;
  tokenBrokerRef?: string;
  refreshTokenBrokerRef?: string;
  callbackBrokerRef?: string;
  codeBrokerRef?: string;
}

export interface PluginInstanceAuthInput {
  method: PluginAuthMethod;
  clientId?: string;
  tenantId?: string;
  principalId?: string;
  refs?: PluginInstanceAuthRefs;
}

export interface PluginInstanceConfig {
  baseUrl?: string;
  endpoint?: string;
  region?: string;
  workspaceId?: string;
  projectKey?: string;
  model?: string;
  organizationId?: string;
  apiVersion?: string;
}

export interface PluginInstanceRecord {
  instanceId: string;
  tenantId: string;
  createdBy: string;
  manifestToolId: string;
  displayName: string;
  status: PluginInstanceStatus;
  auth: PluginInstanceAuthInput;
  config?: PluginInstanceConfig;
  brokerRefs?: {
    authorizationBrokerRef?: string;
    tokenBrokerRef?: string;
    refreshTokenBrokerRef?: string;
    callbackBrokerRef?: string;
    codeBrokerRef?: string;
  };
  lastAuthorizedAt?: string;
  lastTestAt?: string;
  lastTestStatus?: "passed" | "failed";
  lastTestMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRegistryState {
  version: number;
  manifests: ToolManifestRecord[];
  instances: PluginInstanceRecord[];
}

const now = () => new Date().toISOString();

const manifest = (input: Omit<ToolManifestRecord, "createdAt" | "updatedAt">): ToolManifestRecord => {
  const timestamp = now();
  return {
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const catalogManifest = (input: Omit<ToolManifestRecord, "createdAt" | "updatedAt">) => manifest(input);

export const defaultManifests = (): ToolManifestRecord[] => [
  catalogManifest({
    toolId: "connector-ms-fabric-read",
    displayName: "Microsoft Fabric Reader",
    connectorType: "microsoft-fabric",
    description: "Read-only workspace and Lakehouse query access for analytics workflows.",
    version: "1.0.0",
    trustTier: "tier-1",
    allowedActions: ["READ"],
    authMethods: ["oauth2", "service_principal"],
    permissionScopes: ["fabric.workspace.read", "fabric.lakehouse.read"],
    outboundDomains: ["api.fabric.microsoft.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-ms-fabric-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-powerbi-export",
    displayName: "Power BI Export",
    connectorType: "power-bi",
    description: "Exports governed reports and dashboard snapshots for approved audiences.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["powerbi.report.read", "powerbi.export.execute"],
    outboundDomains: ["api.powerbi.com"],
    rateLimitPerMinute: 90,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-powerbi-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-sql-careplan",
    displayName: "SQL Care Plan Reader",
    connectorType: "sql",
    description: "Reads structured care-plan and scheduling records from enterprise SQL.",
    version: "1.0.0",
    trustTier: "tier-1",
    allowedActions: ["READ"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["sql.careplan.read"],
    outboundDomains: ["sql.internal.local"],
    rateLimitPerMinute: 300,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-sql-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-fhir-read",
    displayName: "FHIR Clinical Reader",
    connectorType: "fhir",
    description: "Retrieves patient resources under purpose-of-use restrictions.",
    version: "1.0.0",
    trustTier: "tier-1",
    allowedActions: ["READ"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["fhir.patient.read", "fhir.encounter.read"],
    outboundDomains: ["fhir.hospital.local"],
    rateLimitPerMinute: 240,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-fhir-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-hl7-ingest",
    displayName: "HL7 Interface Ingest",
    connectorType: "hl7",
    description: "Processes HL7 feed messages in constrained runtime channels.",
    version: "1.0.0",
    trustTier: "tier-1",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["hl7.message.read", "hl7.interface.execute"],
    outboundDomains: ["hl7.integration.local"],
    rateLimitPerMinute: 180,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-hl7-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-sharepoint-docs",
    displayName: "SharePoint Governance Connector",
    connectorType: "sharepoint",
    description: "Reads policy playbooks and governed runbook documents.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["sharepoint.docs.read"],
    outboundDomains: ["graph.microsoft.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-sharepoint-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-email-notify",
    displayName: "Outbound Email Notifier",
    connectorType: "email",
    description: "Sends approved outbound notifications with DLP redaction controls.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["EXECUTE"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["email.send.outbound"],
    outboundDomains: ["smtp.enterprise.local"],
    rateLimitPerMinute: 60,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-email-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-ticketing-ops",
    displayName: "Incident Ticketing Connector",
    connectorType: "ticketing",
    description: "Creates and updates incident tickets with policy-linked metadata.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["ticket.read", "ticket.write", "ticket.transition"],
    outboundDomains: ["tickets.enterprise.local"],
    rateLimitPerMinute: 80,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-ticketing-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-linear-project",
    displayName: "Linear Project Connector",
    connectorType: "project",
    description: "Creates and tracks execution, incident, and tranche tasks in Linear.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["linear.issue.read", "linear.issue.write", "linear.comment.write"],
    outboundDomains: ["api.linear.app"],
    rateLimitPerMinute: 70,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-linear-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-aws-infrastructure",
    displayName: "AWS Infrastructure Connector",
    connectorType: "aws",
    description: "Discovers and manages constrained AWS infrastructure and event integrations.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["aws.ec2.read", "aws.lambda.execute", "aws.iam.read"],
    outboundDomains: ["aws.amazon.com", "api.aws.amazon.com"],
    rateLimitPerMinute: 100,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-aws-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-databricks-workspace",
    displayName: "Databricks Workspace Connector",
    connectorType: "databricks",
    description: "Queries notebooks, jobs, and governed data assets in Databricks.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["databricks.workspace.read", "databricks.jobs.execute"],
    outboundDomains: ["*.databricks.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-databricks-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-fabric-automation",
    displayName: "Fabric Automation Connector",
    connectorType: "fabric",
    description: "Automates Microsoft Fabric workspace tasks and lakehouse operations.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["oauth2", "service_principal"],
    permissionScopes: ["fabric.workspace.read", "fabric.workspace.write", "fabric.notebook.execute"],
    outboundDomains: ["api.fabric.microsoft.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-fabric-v2",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-jira-workflow",
    displayName: "Jira Workflow Connector",
    connectorType: "jira",
    description: "Reads and updates Jira projects, issues, and workflow transitions.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["jira.issue.read", "jira.issue.write", "jira.workflow.transition"],
    outboundDomains: ["api.atlassian.com"],
    rateLimitPerMinute: 100,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-jira-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-confluence-knowledge",
    displayName: "Confluence Knowledge Connector",
    connectorType: "confluence",
    description: "Indexes and reads governed Confluence knowledge spaces.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["confluence.page.read", "confluence.page.write"],
    outboundDomains: ["api.atlassian.com"],
    rateLimitPerMinute: 100,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-confluence-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-openai-responses",
    displayName: "OpenAI Responses Connector",
    connectorType: "openai",
    description: "Runs OpenAI responses and tool-enabled reasoning workflows.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key"],
    permissionScopes: ["openai.responses.create"],
    outboundDomains: ["api.openai.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-openai-responses-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-openai-embeddings",
    displayName: "OpenAI Embeddings Connector",
    connectorType: "openai",
    description: "Generates embeddings for retrieval and classification workflows.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key"],
    permissionScopes: ["openai.embeddings.create"],
    outboundDomains: ["api.openai.com"],
    rateLimitPerMinute: 180,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-openai-embeddings-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-anthropic-claude",
    displayName: "Anthropic Claude Connector",
    connectorType: "anthropic",
    description: "Uses Claude models for constrained reasoning and drafting workflows.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key"],
    permissionScopes: ["anthropic.messages.create"],
    outboundDomains: ["api.anthropic.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-anthropic-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-google-gemini",
    displayName: "Google Gemini Connector",
    connectorType: "google",
    description: "Runs Gemini-based reasoning and retrieval workflows in Google environments.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["oauth2", "service_principal", "key_pair"],
    permissionScopes: ["google.generativelanguage.generate", "google.vertexai.invoke"],
    outboundDomains: ["generativelanguage.googleapis.com", "aiplatform.googleapis.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-google-gemini-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-azure-openai",
    displayName: "Azure OpenAI Connector",
    connectorType: "azure-openai",
    description: "Invokes Azure OpenAI deployments for enterprise prompt workflows.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key", "service_principal"],
    permissionScopes: ["azure.openai.deployments.invoke"],
    outboundDomains: ["*.openai.azure.com"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-azure-openai-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-airbyte-sync",
    displayName: "Airbyte Sync Connector",
    connectorType: "airbyte",
    description: "Reads Airbyte connections and triggers governed synchronization jobs.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key"],
    permissionScopes: ["airbyte.connection.read", "airbyte.sync.execute"],
    outboundDomains: ["api.airbyte.com"],
    rateLimitPerMinute: 45,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-airbyte-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-airflow-ops",
    displayName: "Airflow Operations Connector",
    connectorType: "airflow",
    description: "Reads DAG metadata and triggers approved workflow runs in Airflow.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key", "oauth2"],
    permissionScopes: ["airflow.dag.read", "airflow.dag.execute"],
    outboundDomains: ["airflow-api.internal.local"],
    rateLimitPerMinute: 60,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-airflow-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-trino-query",
    displayName: "Trino Query Connector",
    connectorType: "trino",
    description: "Submits read-only Trino queries against governed catalogs and schemas.",
    version: "1.0.0",
    trustTier: "tier-1",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["key_pair", "service_principal"],
    permissionScopes: ["trino.catalog.read", "trino.query.execute"],
    outboundDomains: ["trino.internal.local"],
    rateLimitPerMinute: 180,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-trino-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-superset-insights",
    displayName: "Superset Insights Connector",
    connectorType: "superset",
    description: "Reads dashboards and executes constrained SQL exploration in Superset.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["oauth2", "api_key"],
    permissionScopes: ["superset.dashboard.read", "superset.sql.execute"],
    outboundDomains: ["superset.internal.local"],
    rateLimitPerMinute: 75,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-superset-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-metabase-analytics",
    displayName: "Metabase Analytics Connector",
    connectorType: "metabase",
    description: "Reads approved Metabase collections and executes governed questions.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key", "oauth2"],
    permissionScopes: ["metabase.collection.read", "metabase.question.execute"],
    outboundDomains: ["metabase.internal.local"],
    rateLimitPerMinute: 75,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-metabase-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-grafana-observability",
    displayName: "Grafana Observability Connector",
    connectorType: "grafana",
    description: "Reads dashboards, alerts, and explored metrics from Grafana.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ"],
    authMethods: ["api_key", "oauth2"],
    permissionScopes: ["grafana.dashboard.read", "grafana.alert.read"],
    outboundDomains: ["grafana.internal.local"],
    rateLimitPerMinute: 120,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-grafana-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-kafka-streams",
    displayName: "Kafka Streams Connector",
    connectorType: "kafka",
    description: "Reads topic metadata and publishes approved events to Kafka.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "WRITE", "EXECUTE"],
    authMethods: ["key_pair", "service_principal"],
    permissionScopes: ["kafka.topic.read", "kafka.topic.write"],
    outboundDomains: ["kafka-broker.internal.local"],
    rateLimitPerMinute: 240,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-kafka-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-nifi-flow",
    displayName: "NiFi Flow Connector",
    connectorType: "nifi",
    description: "Reads NiFi process group state and triggers approved flow operations.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["key_pair", "service_principal"],
    permissionScopes: ["nifi.flow.read", "nifi.process-group.execute"],
    outboundDomains: ["nifi.internal.local"],
    rateLimitPerMinute: 90,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-nifi-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-dagster-orchestration",
    displayName: "Dagster Orchestration Connector",
    connectorType: "dagster",
    description: "Reads job metadata and executes approved Dagster runs.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key", "oauth2"],
    permissionScopes: ["dagster.job.read", "dagster.job.execute"],
    outboundDomains: ["dagster.internal.local"],
    rateLimitPerMinute: 60,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-dagster-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-n8n-workflows",
    displayName: "n8n Workflows Connector",
    connectorType: "n8n",
    description: "Reads workflow definitions and executes approved automations in n8n.",
    version: "1.0.0",
    trustTier: "tier-2",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["api_key", "oauth2"],
    permissionScopes: ["n8n.workflow.read", "n8n.workflow.execute"],
    outboundDomains: ["n8n.internal.local"],
    rateLimitPerMinute: 100,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-n8n-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  }),
  catalogManifest({
    toolId: "connector-aws-bedrock-claude",
    displayName: "AWS Bedrock Claude Connector",
    connectorType: "aws",
    description: "Runs Claude models through AWS Bedrock with constrained cloud access.",
    version: "1.0.0",
    trustTier: "tier-3",
    allowedActions: ["READ", "EXECUTE"],
    authMethods: ["service_principal", "key_pair"],
    permissionScopes: ["aws.bedrock.invoke", "aws.sts.assumeRole"],
    outboundDomains: ["bedrock-runtime.amazonaws.com"],
    rateLimitPerMinute: 90,
    idempotent: true,
    mockModeSupported: true,
    signature: "sig-aws-bedrock-claude-v1",
    signedBy: "platform-security",
    status: "published",
    publishedAt: now()
  })
];

export const defaultRegistryState = (): ToolRegistryState => ({
  version: 2,
  manifests: defaultManifests(),
  instances: []
});
