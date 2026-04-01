export type ProjectPackId =
  | "secops-runtime-guard"
  | "revenue-cycle-copilot"
  | "supply-chain-resilience"
  | "clinical-quality-signal"
  | "board-risk-cockpit";

export interface ProjectPackConnector {
  connectorType: string;
  toolId: string;
  purpose: string;
}

export interface ProjectPackControl {
  controlId: string;
  title: string;
  enforcement: string;
}

export interface ProjectPackKpi {
  id: string;
  label: string;
  target: string;
  whyItMatters: string;
}

export interface ProjectPackDefinition {
  packId: ProjectPackId;
  name: string;
  industry: string;
  persona: string;
  businessProblem: string;
  expectedOutcome: string;
  workflowId: string;
  defaultPatientId: string;
  defaultClassification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
  connectors: ProjectPackConnector[];
  controls: ProjectPackControl[];
  kpis: ProjectPackKpi[];
}

export interface ProjectPackDataTable {
  tableId: string;
  title: string;
  description: string;
  source: string;
  classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | boolean>>;
}

export interface ProjectPackPolicyRule {
  ruleId: string;
  title: string;
  condition: string;
  effect: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  rationale: string;
  severity: "critical" | "high" | "medium";
}

export interface ProjectPackPolicyScenarioInput {
  scenarioId: string;
  title: string;
  description: string;
  input: {
    action: string;
    classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "PII" | "PHI" | "EPHI" | "SECRET";
    riskLevel: "low" | "medium" | "high" | "critical";
    mode: "simulation" | "live";
    zeroRetentionRequested: boolean;
    estimatedToolCalls: number;
  };
  operatorHint: string;
}

export interface ProjectPackWalkthroughStep {
  step: number;
  title: string;
  operatorAction: string;
  openAegisControl: string;
  evidenceProduced: string;
}

export interface ProjectPackPolicyPreset {
  profileName: string;
  changeSummary: string;
  controls: Partial<{
    enforceSecretDeny: boolean;
    requireZeroRetentionForPhi: boolean;
    requireApprovalForHighRiskLive: boolean;
    requireDlpOnOutbound: boolean;
    restrictExternalProvidersToZeroRetention: boolean;
    maxToolCallsPerExecution: number;
  }>;
}

export interface ProjectPackExperience {
  plainLanguageSummary: string;
  dataTables: ProjectPackDataTable[];
  policyRules: ProjectPackPolicyRule[];
  policyScenarios: ProjectPackPolicyScenarioInput[];
  walkthrough: ProjectPackWalkthroughStep[];
  trustChecks: string[];
}

export interface ProjectPackSettingsChecklistItem {
  settingId: string;
  label: string;
  required: boolean;
  safeDefault: string;
  why: string;
  impact: "low" | "medium" | "high" | "critical";
}

export interface ProjectPackDailyPlaybookEntry {
  step: number;
  title: string;
  operatorRole: string;
  action: string;
  successSignal: string;
  caution: string;
}

export interface ProjectPackScenarioGuide {
  scenarioId: string;
  title: string;
  useCase: string;
  inputSummary: string;
  outcome: string;
  humanApproval: "none" | "approval" | "dual-approval";
  dashboardView: string;
}

export interface ProjectPackDashboardTrend {
  label: string;
  unit: string;
  series: number[];
}

export interface ProjectPackDashboardAlert {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface ProjectPackDashboardCard {
  title: string;
  value: string;
  detail: string;
}

export interface ProjectPackPersonaDashboard {
  persona: string;
  title: string;
  purpose: string;
  cards: ProjectPackDashboardCard[];
  trends: ProjectPackDashboardTrend[];
  alerts: ProjectPackDashboardAlert[];
}

export interface ProjectPackScreenshotReference {
  id: string;
  title: string;
  path: string;
  note: string;
}

export interface ProjectPackDeepExperience {
  settingsChecklist: ProjectPackSettingsChecklistItem[];
  dailyPlaybook: ProjectPackDailyPlaybookEntry[];
  scenarioGuides: ProjectPackScenarioGuide[];
  personaDashboards: ProjectPackPersonaDashboard[];
  screenshotReferences: ProjectPackScreenshotReference[];
}

export type ProjectPackDetailedExperience = ProjectPackExperience & ProjectPackDeepExperience;

const projectPacks: ProjectPackDefinition[] = [
    {
        packId: "secops-runtime-guard",
        name: "SecOps Runtime Guard",
        industry: "Cross-industry",
        persona: "CISO / SecOps lead",
        businessProblem: "High-risk security actions are scattered across tools without consistent approval, policy, and evidence controls.",
        expectedOutcome: "Containment workflows execute with policy-first control and auditable approvals for risky actions.",
        workflowId: "wf-secops-runtime-guard",
        defaultPatientId: "patient-1001",
        defaultClassification: "SECRET",
        connectors: [
            {
                connectorType: "kafka",
                toolId: "connector-kafka-streams",
                purpose: "Ingest normalized runtime alerts and control events."
            },
            {
                connectorType: "grafana",
                toolId: "connector-grafana-observability",
                purpose: "Correlate alerts with dashboards and active incidents."
            },
            {
                connectorType: "ticketing",
                toolId: "connector-ticketing-ops",
                purpose: "Open and update incident response tickets."
            }
        ],
        controls: [
            {
                controlId: "require_high_risk_approval",
                title: "Human approval for high-risk live actions",
                enforcement: "Live containment actions require explicit approver decision."
            },
            {
                controlId: "deny_secret_exfiltration",
                title: "Deny SECRET exfiltration paths",
                enforcement: "Outbound actions with SECRET data are blocked by policy."
            }
        ],
        kpis: [
            {
                id: "kpi-approval-latency",
                label: "Approval latency",
                target: "< 5 minutes for critical containment requests",
                whyItMatters: "Measures whether controls are practical in real incidents."
            },
            {
                id: "kpi-blocked-unsafe-actions",
                label: "Blocked unsafe actions",
                target: "100% of unapproved high-risk actions blocked",
                whyItMatters: "Proves policy enforcement outside the model."
            }
        ]
    },
    {
        packId: "revenue-cycle-copilot",
        name: "Revenue Cycle Copilot",
        industry: "Healthcare finance",
        persona: "CFO / Revenue operations",
        businessProblem: "Claim denials and coding exceptions consume analyst time with inconsistent controls over sensitive data workflows.",
        expectedOutcome: "Analysts automate triage safely while approvals and PHI handling policies remain enforced.",
        workflowId: "wf-revenue-cycle-copilot",
        defaultPatientId: "patient-1001",
        defaultClassification: "PHI",
        connectors: [
            {
                connectorType: "trino",
                toolId: "connector-trino-query",
                purpose: "Query governed billing and claims datasets."
            },
            {
                connectorType: "airflow",
                toolId: "connector-airflow-ops",
                purpose: "Schedule reconciliation and exception workflows."
            },
            {
                connectorType: "superset",
                toolId: "connector-superset-insights",
                purpose: "Publish approved denial and recovery dashboards."
            }
        ],
        controls: [
            {
                controlId: "zero_retention_phi",
                title: "Zero-retention model routing for PHI",
                enforcement: "PHI requests route only to approved zero-retention providers."
            },
            {
                controlId: "dlp_outbound",
                title: "DLP on outbound summaries",
                enforcement: "Outbound artifacts are redacted and logged before release."
            }
        ],
        kpis: [
            {
                id: "kpi-denial-turnaround",
                label: "Denial triage turnaround",
                target: "30% faster triage cycle",
                whyItMatters: "Directly impacts working capital and reimbursement speed."
            },
            {
                id: "kpi-audit-completeness",
                label: "Audit completeness",
                target: "100% exception decisions linked to evidence IDs",
                whyItMatters: "Supports compliance and dispute handling."
            }
        ]
    },
    {
        packId: "supply-chain-resilience",
        name: "Supply Chain Resilience",
        industry: "Healthcare operations",
        persona: "COO / Supply chain lead",
        businessProblem: "Critical shortages are addressed too late because inventory, workflow, and escalation systems are disconnected.",
        expectedOutcome: "OpenAegis orchestrates shortage detection and controlled escalation with clear approvals and traceability.",
        workflowId: "wf-supply-chain-resilience",
        defaultPatientId: "patient-1001",
        defaultClassification: "INTERNAL",
        connectors: [
            {
                connectorType: "airbyte",
                toolId: "connector-airbyte-sync",
                purpose: "Sync procurement and inventory feeds into governed datasets."
            },
            {
                connectorType: "dagster",
                toolId: "connector-dagster-orchestration",
                purpose: "Run resilience scoring and replenishment jobs."
            },
            {
                connectorType: "project",
                toolId: "connector-linear-project",
                purpose: "Track mitigation tasks and ownership."
            }
        ],
        controls: [
            {
                controlId: "approved_write_scopes",
                title: "Approved write scopes only",
                enforcement: "Only signed connector scopes can create procurement actions."
            },
            {
                controlId: "execution_budget",
                title: "Execution budget guardrails",
                enforcement: "Agent actions stay within bounded step and tool-call limits."
            }
        ],
        kpis: [
            {
                id: "kpi-shortage-escalation",
                label: "Critical shortage escalation time",
                target: "< 15 minutes from detection to assignment",
                whyItMatters: "Reduces operational disruption risk."
            },
            {
                id: "kpi-idempotent-actions",
                label: "Idempotent escalation actions",
                target: "0 duplicate escalations during retries",
                whyItMatters: "Prevents noisy and costly duplicate operations."
            }
        ]
    },
    {
        packId: "clinical-quality-signal",
        name: "Clinical Quality Signal",
        industry: "Healthcare quality",
        persona: "CMO / Quality director",
        businessProblem: "Clinical quality risks are discovered late and root-cause evidence is hard to assemble quickly.",
        expectedOutcome: "Quality signals are detected earlier with regulated data controls and auditable review workflow.",
        workflowId: "wf-clinical-quality-signal",
        defaultPatientId: "patient-2002",
        defaultClassification: "EPHI",
        connectors: [
            {
                connectorType: "fhir",
                toolId: "connector-fhir-read",
                purpose: "Read patient and encounter records for quality signals."
            },
            {
                connectorType: "hl7",
                toolId: "connector-hl7-ingest",
                purpose: "Ingest interface events tied to quality incidents."
            },
            {
                connectorType: "metabase",
                toolId: "connector-metabase-analytics",
                purpose: "Deliver approved quality dashboards to stakeholders."
            }
        ],
        controls: [
            {
                controlId: "purpose_of_use",
                title: "Purpose-of-use restricted retrieval",
                enforcement: "Clinical retrieval requires approved purpose and role context."
            },
            {
                controlId: "approval_for_live_notifications",
                title: "Approval for live outbound notifications",
                enforcement: "High-risk patient communications require a human gate."
            }
        ],
        kpis: [
            {
                id: "kpi-signal-detection",
                label: "Signal detection lead time",
                target: "20% faster detection of high-risk quality events",
                whyItMatters: "Improves patient safety and response posture."
            },
            {
                id: "kpi-trace-completeness",
                label: "Trace completeness",
                target: "100% quality escalations with policy + data-source lineage",
                whyItMatters: "Supports regulatory and quality committee review."
            }
        ]
    },
    {
        packId: "board-risk-cockpit",
        name: "Board Risk Cockpit",
        industry: "Enterprise governance",
        persona: "CEO / Board / Risk committee",
        businessProblem: "Executive risk reporting is delayed and lacks traceable evidence behind each claim.",
        expectedOutcome: "Board-level risk reporting is generated with evidence lineage and explicit control status.",
        workflowId: "wf-board-risk-cockpit",
        defaultPatientId: "patient-1001",
        defaultClassification: "CONFIDENTIAL",
        connectors: [
            {
                connectorType: "trino",
                toolId: "connector-trino-query",
                purpose: "Federate risk and control datasets across sources."
            },
            {
                connectorType: "superset",
                toolId: "connector-superset-insights",
                purpose: "Publish board-facing risk visuals."
            },
            {
                connectorType: "sharepoint",
                toolId: "connector-sharepoint-docs",
                purpose: "Store approved briefing artifacts in governance repository."
            }
        ],
        controls: [
            {
                controlId: "disclosure_control",
                title: "Disclosure control and redaction",
                enforcement: "Sensitive content is redacted based on role and audience."
            },
            {
                controlId: "immutable_audit",
                title: "Immutable evidence chain",
                enforcement: "Each report claim references policy checks and evidence IDs."
            }
        ],
        kpis: [
            {
                id: "kpi-board-report-cycle",
                label: "Board report cycle time",
                target: "50% faster preparation cycle",
                whyItMatters: "Improves governance responsiveness without weakening controls."
            },
            {
                id: "kpi-evidence-backed-claims",
                label: "Evidence-backed claims",
                target: "100% of board claims linked to auditable evidence",
                whyItMatters: "Raises trust and defensibility in executive decisions."
            }
        ]
    }
];
const projectPackExperiences: Record<ProjectPackId, ProjectPackExperience> = {
  "secops-runtime-guard": {
    plainLanguageSummary: "Security team triages threats while OpenAegis enforces approvals and blocks unsafe exfiltration.",
    dataTables: [
      {
        tableId: "runtime-alerts",
        title: "Runtime Alerts",
        description: "Critical detections from SIEM and runtime telemetry.",
        source: "Kafka secops.runtime.alerts",
        classification: "SECRET",
        columns: [
          { key: "alert_id", label: "Alert ID" },
          { key: "asset", label: "Asset" },
          { key: "severity", label: "Severity" },
          { key: "status", label: "Status" }
        ],
        rows: [
          { alert_id: "ALRT-9012", asset: "prod-k8s-node-14", severity: "critical", status: "investigating" },
          { alert_id: "ALRT-9013", asset: "db-replica-03", severity: "high", status: "blocked" }
        ]
      }
    ],
    policyRules: [
      {
        ruleId: "secops-rule-1",
        title: "Live high-risk actions require approval",
        condition: "mode = live AND riskLevel in [high, critical]",
        effect: "REQUIRE_APPROVAL",
        rationale: "Prevents unreviewed containment actions.",
        severity: "critical"
      },
      {
        ruleId: "secops-rule-2",
        title: "SECRET outbound transfer denied",
        condition: "classification = SECRET AND outbound action",
        effect: "DENY",
        rationale: "Prevents data leakage by default.",
        severity: "critical"
      }
    ],
    policyScenarios: [
      {
        scenarioId: "secops-sim",
        title: "Simulation isolate host",
        description: "Triage isolation in simulation mode.",
        input: {
          action: "secops.isolate-host",
          classification: "SECRET",
          riskLevel: "high",
          mode: "simulation",
          zeroRetentionRequested: true,
          estimatedToolCalls: 3
        },
        operatorHint: "Should execute in simulation with evidence."
      },
      {
        scenarioId: "secops-live",
        title: "Live isolate host",
        description: "Production host isolation request.",
        input: {
          action: "secops.isolate-host",
          classification: "SECRET",
          riskLevel: "critical",
          mode: "live",
          zeroRetentionRequested: true,
          estimatedToolCalls: 4
        },
        operatorHint: "Should require approval."
      }
    ],
    walkthrough: [
      {
        step: 1,
        title: "Inspect alerts",
        operatorAction: "Open Runtime Alerts.",
        openAegisControl: "Tenant and classification guardrails enforced before display.",
        evidenceProduced: "Audit read event."
      },
      {
        step: 2,
        title: "Validate policy",
        operatorAction: "Review policy scenarios.",
        openAegisControl: "Policy decisions run outside the model.",
        evidenceProduced: "Decision reasons and obligations."
      },
      {
        step: 3,
        title: "Run simulation and live",
        operatorAction: "Run both modes from the same pack.",
        openAegisControl: "Live mode pauses for approval; simulation completes.",
        evidenceProduced: "Execution and approval IDs."
      },
      {
        step: 4,
        title: "Approve and replay",
        operatorAction: "Approve and verify final execution status.",
        openAegisControl: "Single-use approval binding stops replay abuse.",
        evidenceProduced: "Approval decision and bound tool-call hash."
      }
    ],
    trustChecks: ["High-risk live actions do not bypass humans.", "SECRET outbound paths are denied by default."]
  },
  "revenue-cycle-copilot": {
    plainLanguageSummary: "Finance analysts reduce denial backlog while PHI routing and approvals remain enforced.",
    dataTables: [
      {
        tableId: "claim-denials",
        title: "Claim Denial Queue",
        description: "High-value denials needing appeal.",
        source: "Trino finops.denials_current",
        classification: "PHI",
        columns: [
          { key: "claim_id", label: "Claim ID" },
          { key: "payer", label: "Payer" },
          { key: "amount", label: "Amount" },
          { key: "priority", label: "Priority" }
        ],
        rows: [
          { claim_id: "CLM-884401", payer: "Aetna", amount: 18425, priority: "high" },
          { claim_id: "CLM-884455", payer: "United", amount: 9720, priority: "medium" }
        ]
      }
    ],
    policyRules: [
      {
        ruleId: "rev-rule-1",
        title: "PHI requires zero-retention route",
        condition: "classification in [PHI, EPHI]",
        effect: "DENY",
        rationale: "Prevents PHI routing to unsafe providers.",
        severity: "critical"
      },
      {
        ruleId: "rev-rule-2",
        title: "Live high-risk writeback requires approval",
        condition: "mode = live AND riskLevel = high",
        effect: "REQUIRE_APPROVAL",
        rationale: "Stops unreviewed billing writebacks.",
        severity: "high"
      }
    ],
    policyScenarios: [
      {
        scenarioId: "rev-sim",
        title: "Simulation denial triage",
        description: "Generate prioritized appeal worklist.",
        input: {
          action: "revenue.triage-denials",
          classification: "PHI",
          riskLevel: "medium",
          mode: "simulation",
          zeroRetentionRequested: true,
          estimatedToolCalls: 4
        },
        operatorHint: "Should allow in simulation."
      },
      {
        scenarioId: "rev-live",
        title: "Live appeal writeback",
        description: "Write appeal outcome to billing platform.",
        input: {
          action: "revenue.writeback-appeal",
          classification: "PHI",
          riskLevel: "high",
          mode: "live",
          zeroRetentionRequested: true,
          estimatedToolCalls: 5
        },
        operatorHint: "Should require approval before write."
      }
    ],
    walkthrough: [
      {
        step: 1,
        title: "Load denial queue",
        operatorAction: "Review highest-value denials.",
        openAegisControl: "PHI classification tags are applied to rows.",
        evidenceProduced: "Read audit events with source lineage."
      },
      {
        step: 2,
        title: "Apply revenue baseline",
        operatorAction: "Security admin applies preset controls.",
        openAegisControl: "Role-gated policy save with versioning.",
        evidenceProduced: "Policy profile update event."
      },
      {
        step: 3,
        title: "Run simulation then live",
        operatorAction: "Run both modes and compare outcomes.",
        openAegisControl: "Live path blocks on high-risk writeback.",
        evidenceProduced: "Execution IDs and approval gate."
      },
      {
        step: 4,
        title: "Approve and verify",
        operatorAction: "Approve and verify execution completion.",
        openAegisControl: "Approval linked to execution and evidence.",
        evidenceProduced: "Approval and audit trail."
      }
    ],
    trustChecks: ["PHI routing remains policy-controlled.", "Revenue writes cannot skip approval."]
  },
  "supply-chain-resilience": {
    plainLanguageSummary: "Operations can escalate shortages quickly without letting automation issue unsafe or duplicate writes.",
    dataTables: [
      {
        tableId: "inventory-watch",
        title: "Critical Inventory Watchlist",
        description: "Shortage watchlist with clinical impact.",
        source: "Airbyte ops.inventory_watch",
        classification: "INTERNAL",
        columns: [
          { key: "item", label: "Item" },
          { key: "location", label: "Location" },
          { key: "hours_left", label: "Hours Left" },
          { key: "clinical_impact", label: "Clinical Impact" }
        ],
        rows: [
          { item: "IV saline 500ml", location: "Hospital North", hours_left: 18, clinical_impact: "high" },
          { item: "N95 respirators", location: "Hospital East", hours_left: 31, clinical_impact: "medium" }
        ]
      }
    ],
    policyRules: [
      {
        ruleId: "supply-rule-1",
        title: "Procurement writes require approval",
        condition: "action includes procurement write",
        effect: "REQUIRE_APPROVAL",
        rationale: "Prevents unauthorized purchasing.",
        severity: "high"
      },
      {
        ruleId: "supply-rule-2",
        title: "Tool-call budget cap",
        condition: "estimatedToolCalls > maxToolCallsPerExecution",
        effect: "DENY",
        rationale: "Stops runaway orchestration loops.",
        severity: "high"
      }
    ],
    policyScenarios: [
      {
        scenarioId: "supply-sim",
        title: "Simulation shortage detection",
        description: "Generate mitigation plan from watchlist.",
        input: {
          action: "supply.detect-shortage",
          classification: "INTERNAL",
          riskLevel: "medium",
          mode: "simulation",
          zeroRetentionRequested: true,
          estimatedToolCalls: 4
        },
        operatorHint: "Should allow with auditable plan output."
      },
      {
        scenarioId: "supply-live",
        title: "Live purchase order create",
        description: "Create procurement order for critical shortage.",
        input: {
          action: "supply.create-po",
          classification: "CONFIDENTIAL",
          riskLevel: "high",
          mode: "live",
          zeroRetentionRequested: true,
          estimatedToolCalls: 5
        },
        operatorHint: "Should require approval."
      }
    ],
    walkthrough: [
      {
        step: 1,
        title: "Review shortage rows",
        operatorAction: "Pick one critical shortage record.",
        openAegisControl: "Data access is tenant-scoped and logged.",
        evidenceProduced: "Data read audit event."
      },
      {
        step: 2,
        title: "Review policy scenarios",
        operatorAction: "Read expected outcomes before live run.",
        openAegisControl: "Policy engine calculates decision and obligations.",
        evidenceProduced: "Scenario decisions."
      },
      {
        step: 3,
        title: "Run simulation and live",
        operatorAction: "Execute both modes.",
        openAegisControl: "Live procurement blocks pending approval.",
        evidenceProduced: "Execution and approval records."
      },
      {
        step: 4,
        title: "Approve once",
        operatorAction: "Approve and verify one-time execution.",
        openAegisControl: "Idempotent binding prevents duplicate writes.",
        evidenceProduced: "Approval binding evidence."
      }
    ],
    trustChecks: ["No uncontrolled procurement actions.", "Execution loops remain bounded."]
  },
  "clinical-quality-signal": {
    plainLanguageSummary: "Clinical teams detect quality risks faster while OpenAegis keeps ePHI and notifications under strict control.",
    dataTables: [
      {
        tableId: "quality-signals",
        title: "Quality Signal Candidates",
        description: "Signals from encounters and outcomes.",
        source: "FHIR quality.signal_feed",
        classification: "EPHI",
        columns: [
          { key: "signal_id", label: "Signal ID" },
          { key: "patient", label: "Patient" },
          { key: "signal_type", label: "Signal Type" },
          { key: "risk_score", label: "Risk Score" }
        ],
        rows: [
          { signal_id: "QS-5521", patient: "patient-2002", signal_type: "post-op infection", risk_score: 91 },
          { signal_id: "QS-5528", patient: "patient-1001", signal_type: "medication gap", risk_score: 78 }
        ]
      }
    ],
    policyRules: [
      {
        ruleId: "clinical-rule-1",
        title: "ePHI requires zero-retention route",
        condition: "classification in [PHI, EPHI]",
        effect: "DENY",
        rationale: "Blocks unsafe model routing for patient data.",
        severity: "critical"
      },
      {
        ruleId: "clinical-rule-2",
        title: "High-risk live notifications require approval",
        condition: "mode = live AND riskLevel = high",
        effect: "REQUIRE_APPROVAL",
        rationale: "Requires clinician oversight before patient-impacting communication.",
        severity: "critical"
      }
    ],
    policyScenarios: [
      {
        scenarioId: "clinical-sim",
        title: "Simulation quality scoring",
        description: "Score quality signals in simulation.",
        input: {
          action: "clinical.score-quality-signals",
          classification: "EPHI",
          riskLevel: "medium",
          mode: "simulation",
          zeroRetentionRequested: true,
          estimatedToolCalls: 5
        },
        operatorHint: "Should allow in simulation."
      },
      {
        scenarioId: "clinical-live",
        title: "Live high-risk notification",
        description: "Notify care team for high-risk signal.",
        input: {
          action: "clinical.send-care-notification",
          classification: "PHI",
          riskLevel: "high",
          mode: "live",
          zeroRetentionRequested: true,
          estimatedToolCalls: 4
        },
        operatorHint: "Should require approval."
      }
    ],
    walkthrough: [
      {
        step: 1,
        title: "Load quality signals",
        operatorAction: "Open quality signal table.",
        openAegisControl: "EPHI classification controls are active.",
        evidenceProduced: "Read audit event with classification."
      },
      {
        step: 2,
        title: "Apply clinical baseline",
        operatorAction: "Apply preset with zero-retention and DLP controls.",
        openAegisControl: "Policy update requires privileged role.",
        evidenceProduced: "Policy profile change event."
      },
      {
        step: 3,
        title: "Run simulation and live",
        operatorAction: "Compare simulation and live decisions.",
        openAegisControl: "Live path requires approval for high-risk notification.",
        evidenceProduced: "Execution and approval IDs."
      },
      {
        step: 4,
        title: "Approve and verify",
        operatorAction: "Approve and confirm completion.",
        openAegisControl: "Approval is tied to single execution context.",
        evidenceProduced: "Approval trace and audit chain."
      }
    ],
    trustChecks: ["ePHI policy is enforced before model/tool use.", "Patient-impacting notifications require humans."]
  },
  "board-risk-cockpit": {
    plainLanguageSummary: "Executives get faster board reporting while every claim remains evidence-backed and policy-reviewed.",
    dataTables: [
      {
        tableId: "risk-register",
        title: "Enterprise Risk Register",
        description: "Top risks consolidated across domains.",
        source: "Trino governance.risk_register",
        classification: "CONFIDENTIAL",
        columns: [
          { key: "risk_id", label: "Risk ID" },
          { key: "domain", label: "Domain" },
          { key: "impact", label: "Impact" },
          { key: "owner", label: "Owner" }
        ],
        rows: [
          { risk_id: "RISK-77", domain: "Cyber", impact: "high", owner: "CISO" },
          { risk_id: "RISK-81", domain: "Clinical quality", impact: "high", owner: "CMO" }
        ]
      }
    ],
    policyRules: [
      {
        ruleId: "board-rule-1",
        title: "Confidential live publish requires approval",
        condition: "classification = CONFIDENTIAL AND mode = live",
        effect: "REQUIRE_APPROVAL",
        rationale: "Ensures governance sign-off before publication.",
        severity: "high"
      },
      {
        ruleId: "board-rule-2",
        title: "External disclosure denied",
        condition: "action targets external audience",
        effect: "DENY",
        rationale: "Prevents accidental executive disclosure.",
        severity: "critical"
      }
    ],
    policyScenarios: [
      {
        scenarioId: "board-sim",
        title: "Simulation board brief assembly",
        description: "Prepare board brief in simulation.",
        input: {
          action: "board.assemble-brief",
          classification: "CONFIDENTIAL",
          riskLevel: "medium",
          mode: "simulation",
          zeroRetentionRequested: true,
          estimatedToolCalls: 5
        },
        operatorHint: "Should allow and produce draft with evidence links."
      },
      {
        scenarioId: "board-live",
        title: "Live board publish",
        description: "Publish board briefing to repository.",
        input: {
          action: "board.publish-brief",
          classification: "CONFIDENTIAL",
          riskLevel: "high",
          mode: "live",
          zeroRetentionRequested: true,
          estimatedToolCalls: 5
        },
        operatorHint: "Should require approval."
      }
    ],
    walkthrough: [
      {
        step: 1,
        title: "Inspect risk register",
        operatorAction: "Review top risks and owners.",
        openAegisControl: "Role-filtered confidential data view.",
        evidenceProduced: "Data access audit event."
      },
      {
        step: 2,
        title: "Evaluate publish scenarios",
        operatorAction: "Review live publish controls.",
        openAegisControl: "Policy gates run before any distribution.",
        evidenceProduced: "Scenario decisions and obligations."
      },
      {
        step: 3,
        title: "Run simulation and live",
        operatorAction: "Run pack in both modes.",
        openAegisControl: "Live publication pauses for approval.",
        evidenceProduced: "Execution and approval records."
      },
      {
        step: 4,
        title: "Approve and trace claim",
        operatorAction: "Approve live run and inspect evidence chain.",
        openAegisControl: "Evidence links enable defensible board claims.",
        evidenceProduced: "Audit-linked evidence references."
      }
    ],
    trustChecks: ["No unreviewed board publication.", "Evidence chain is attached to published claims."]
  }
};

const projectPackDeepMaterials: Record<ProjectPackId, ProjectPackDeepExperience> = {
  "secops-runtime-guard": {
    settingsChecklist: [
      { settingId: "tenant-scope", label: "Tenant scope", required: true, safeDefault: "tenant-starlight-health", why: "Keeps containment actions isolated to one tenant.", impact: "critical" },
      { settingId: "approval-mode", label: "Approval mode", required: true, safeDefault: "human-approval-required", why: "Prevents autonomous destructive actions.", impact: "critical" },
      { settingId: "egress-control", label: "Outbound egress", required: true, safeDefault: "deny-by-default", why: "Stops exfiltration unless the policy explicitly opens a path.", impact: "critical" },
      { settingId: "retention", label: "Evidence retention", required: true, safeDefault: "immutable-6y", why: "Preserves incident history and chain of custody.", impact: "high" }
    ],
    dailyPlaybook: [
      { step: 1, title: "Start of shift", operatorRole: "SecOps analyst", action: "Review open alerts and classify by severity.", successSignal: "Alerts are triaged and ownership is assigned.", caution: "Never copy raw alert payloads into chat tools." },
      { step: 2, title: "Containment review", operatorRole: "Security reviewer", action: "Open the pending containment actions queue and inspect required approvals.", successSignal: "Each live action has a policy decision and approver slot.", caution: "Do not approve without confirming scope and source." },
      { step: 3, title: "Escalation", operatorRole: "Incident commander", action: "Promote only approved actions to execution.", successSignal: "Execution is single-use and audit-backed.", caution: "Replays must be rejected unless the request hash matches." },
      { step: 4, title: "Shift handoff", operatorRole: "Auditor", action: "Export evidence bundle and annotate closed incidents.", successSignal: "Evidence IDs line up with the incident timeline.", caution: "Do not remove or alter evidence artifacts." }
    ],
    scenarioGuides: [
      { scenarioId: "secops-sim", title: "Simulation isolate host", useCase: "Practice response without impact.", inputSummary: "SECRET, high risk, simulation mode.", outcome: "ALLOW with full evidence trail.", humanApproval: "none", dashboardView: "Security dashboard shows queued evidence and no live execution." },
      { scenarioId: "secops-live", title: "Live isolate host", useCase: "Contain an active host in production.", inputSummary: "SECRET, critical, live mode.", outcome: "REQUIRE_APPROVAL before execution.", humanApproval: "approval", dashboardView: "Security dashboard shows approval latency and action status." },
      { scenarioId: "secops-exfil", title: "Outbound export attempt", useCase: "Test exfiltration resistance.", inputSummary: "SECRET outbound transfer requested.", outcome: "DENY with reason code.", humanApproval: "none", dashboardView: "Alert banner flags blocked exfiltration and incident ID." }
    ],
    personaDashboards: [
      {
        persona: "security_admin",
        title: "Threat Ops Dashboard",
        purpose: "See active alerts, approvals, and blocked actions.",
        cards: [
          { title: "Open critical alerts", value: "2", detail: "One simulation, one live queue item." },
          { title: "Pending approvals", value: "1", detail: "Waiting on approver decision." },
          { title: "Blocked outbound actions", value: "1", detail: "SECRET exfiltration denied." }
        ],
        trends: [
          { label: "Approval latency", unit: "min", series: [6, 4, 5, 3, 2] },
          { label: "Blocked actions", unit: "count", series: [1, 2, 2, 3, 4] }
        ],
        alerts: [
          { severity: "critical", title: "Possible exfiltration", detail: "Outbound request to untrusted destination was denied." },
          { severity: "warning", title: "Approval pending", detail: "Live containment action is waiting on human review." }
        ]
      },
      {
        persona: "executive",
        title: "Risk Oversight Dashboard",
        purpose: "Summarize operational risk posture for leadership.",
        cards: [
          { title: "Live actions gated", value: "100%", detail: "All live high-risk actions are approval-gated." },
          { title: "Evidence completeness", value: "100%", detail: "Every run has an evidence ID." },
          { title: "Mean time to approval", value: "3m", detail: "Current pilot median." }
        ],
        trends: [
          { label: "Open incidents", unit: "count", series: [5, 4, 4, 3, 2] },
          { label: "Approval queue time", unit: "min", series: [4, 5, 4, 3, 3] }
        ],
        alerts: [
          { severity: "info", title: "Containment healthy", detail: "No unapproved live actions executed." }
        ]
      }
    ],
    screenshotReferences: [
      { id: "secops-setup", title: "SecOps setup", path: "docs/assets/screenshots/commercial-setup.png", note: "Use this for setup and baseline flow." },
      { id: "secops-security", title: "Security console", path: "docs/assets/screenshots/commercial-security.png", note: "Shows policy and approval control." },
      { id: "secops-audit", title: "Audit explorer", path: "docs/assets/screenshots/commercial-audit.png", note: "Shows evidence chain and replayability." }
    ]
  },
  "revenue-cycle-copilot": {
    settingsChecklist: [
      { settingId: "phi-routing", label: "PHI routing", required: true, safeDefault: "zero-retention-only", why: "Prevents PHI from reaching non-compliant providers.", impact: "critical" },
      { settingId: "billing-writeback", label: "Billing writeback", required: true, safeDefault: "approval-required", why: "Stops unsupported claim edits.", impact: "high" },
      { settingId: "redaction", label: "Outbound redaction", required: true, safeDefault: "on", why: "Removes sensitive fields from summaries.", impact: "critical" },
      { settingId: "query-scope", label: "Data query scope", required: true, safeDefault: "claims-only", why: "Limits data access to the minimum needed.", impact: "high" }
    ],
    dailyPlaybook: [
      { step: 1, title: "Morning backlog review", operatorRole: "Revenue analyst", action: "Sort denials by value and aging.", successSignal: "High-value claims are queued first.", caution: "Do not widen the query to unrelated patient data." },
      { step: 2, title: "Appeal drafting", operatorRole: "Revenue analyst", action: "Run simulation to generate appeal packet drafts.", successSignal: "Draft packet has evidence and redaction markers.", caution: "Drafts are never sent directly." },
      { step: 3, title: "Approval review", operatorRole: "Revenue manager", action: "Approve only appeals with clear clinical justification.", successSignal: "Approved items proceed to writeback.", caution: "Never approve without reviewing the source claim." },
      { step: 4, title: "End-of-day reconciliation", operatorRole: "Finance ops", action: "Confirm completion and compare recovery rate.", successSignal: "Completed items have evidence IDs and status changes.", caution: "No PHI may be copied into non-governed spreadsheets." }
    ],
    scenarioGuides: [
      { scenarioId: "revenue-sim", title: "Denial triage draft", useCase: "Create appeal worklist safely.", inputSummary: "PHI, medium risk, simulation.", outcome: "ALLOW with audit trail.", humanApproval: "none", dashboardView: "Finance dashboard shows triage throughput and queue size." },
      { scenarioId: "revenue-live", title: "Appeal writeback", useCase: "Write a corrected appeal to the billing system.", inputSummary: "PHI, high risk, live mode.", outcome: "REQUIRE_APPROVAL before writeback.", humanApproval: "approval", dashboardView: "Approval inbox and revenue dashboard update together." },
      { scenarioId: "revenue-badroute", title: "Unsafe PHI route", useCase: "Test unsafe provider selection.", inputSummary: "PHI with zero retention disabled.", outcome: "DENY due to policy.", humanApproval: "none", dashboardView: "Dashboard flags the blocked route and redaction warning." }
    ],
    personaDashboards: [
      {
        persona: "analyst",
        title: "Worklist Dashboard",
        purpose: "Show claims waiting to be reviewed.",
        cards: [
          { title: "Claims in queue", value: "42", detail: "Prioritized by expected recovery." },
          { title: "Ready for draft", value: "18", detail: "Simulation completed." },
          { title: "Needs human review", value: "7", detail: "Approval required before writeback." }
        ],
        trends: [
          { label: "Average triage time", unit: "min", series: [21, 20, 18, 15, 14] },
          { label: "Recovery rate", unit: "%", series: [54, 56, 57, 60, 61] }
        ],
        alerts: [
          { severity: "warning", title: "PHI route blocked", detail: "One draft used a non-zero-retention provider and was denied." }
        ]
      },
      {
        persona: "executive",
        title: "Revenue Operations Dashboard",
        purpose: "Show business impact and compliance posture.",
        cards: [
          { title: "Cycle time improvement", value: "30%", detail: "Compared with prior manual process." },
          { title: "Evidence linked decisions", value: "100%", detail: "All approved decisions have evidence IDs." },
          { title: "Denied unsafe routes", value: "1", detail: "No leakage paths passed policy." }
        ],
        trends: [
          { label: "Recovered dollars", unit: "$k", series: [120, 138, 145, 150, 161] },
          { label: "Blocked risky actions", unit: "count", series: [1, 1, 2, 2, 3] }
        ],
        alerts: [
          { severity: "info", title: "Audit complete", detail: "Revenue operations have full evidence coverage." }
        ]
      }
    ],
    screenshotReferences: [
      { id: "revenue-setup", title: "Revenue setup", path: "docs/assets/screenshots/commercial-setup.png", note: "Shows the starting point and required identities." },
      { id: "revenue-dashboard", title: "Revenue dashboard", path: "docs/assets/screenshots/commercial-dashboard.png", note: "Shows the financial outcome metrics." },
      { id: "revenue-approvals", title: "Approval inbox", path: "docs/assets/screenshots/commercial-approvals.png", note: "Shows the human gate for writeback." }
    ]
  },
  "supply-chain-resilience": {
    settingsChecklist: [
      { settingId: "write-scopes", label: "Write scopes", required: true, safeDefault: "procurement-only", why: "Limits automation to approved purchase operations.", impact: "high" },
      { settingId: "retry-budget", label: "Retry budget", required: true, safeDefault: "3 attempts", why: "Prevents duplicate escalations.", impact: "medium" },
      { settingId: "escalation-target", label: "Escalation target", required: true, safeDefault: "ops-channel", why: "Keeps response routing visible.", impact: "high" },
      { settingId: "approval-policy", label: "Approval policy", required: true, safeDefault: "high-risk-live-only", why: "Only live write actions need approval.", impact: "critical" }
    ],
    dailyPlaybook: [
      { step: 1, title: "Watch inventory", operatorRole: "Ops lead", action: "Check low-stock rows and reorder thresholds.", successSignal: "Watchlist highlights shortage candidates.", caution: "Do not manually edit source records." },
      { step: 2, title: "Draft mitigation", operatorRole: "Planner", action: "Run simulation to draft mitigation tasks.", successSignal: "Tasks are created in draft state.", caution: "Drafts stay non-authoritative until reviewed." },
      { step: 3, title: "Approval and action", operatorRole: "Procurement manager", action: "Approve purchase order creation when needed.", successSignal: "One approved purchase order executes once.", caution: "Never reuse an old approval." },
      { step: 4, title: "Track closure", operatorRole: "Operations manager", action: "Close the loop and verify stock recovers.", successSignal: "Stock trend improves and tasks close.", caution: "Do not mark closure without vendor confirmation." }
    ],
    scenarioGuides: [
      { scenarioId: "supply-sim", title: "Shortage detection", useCase: "Create mitigation plan from watchlist.", inputSummary: "INTERNAL, medium risk, simulation.", outcome: "ALLOW with task draft.", humanApproval: "none", dashboardView: "Ops dashboard shows draft tasks and shortage trend." },
      { scenarioId: "supply-live", title: "Purchase order create", useCase: "Place an actual replenishment order.", inputSummary: "CONFIDENTIAL, high risk, live.", outcome: "REQUIRE_APPROVAL.", humanApproval: "approval", dashboardView: "Approval queue shows order summary and scope." },
      { scenarioId: "supply-loop", title: "Retry loop check", useCase: "Ensure retries do not duplicate tasks.", inputSummary: "INTERNAL, medium risk, simulation with retries.", outcome: "ALLOW, but idempotency enforced.", humanApproval: "none", dashboardView: "Dashboard should show zero duplicate actions." }
    ],
    personaDashboards: [
      {
        persona: "ops_lead",
        title: "Supply Watch Dashboard",
        purpose: "Spot shortages before they become outages.",
        cards: [
          { title: "Critical items", value: "2", detail: "Below threshold within 24h." },
          { title: "Draft mitigations", value: "4", detail: "Queued by the planner." },
          { title: "Orders awaiting approval", value: "1", detail: "Live write action blocked." }
        ],
        trends: [
          { label: "Stock coverage", unit: "hours", series: [40, 35, 28, 22, 26] },
          { label: "Duplicate attempts", unit: "count", series: [0, 0, 0, 1, 0] }
        ],
        alerts: [
          { severity: "warning", title: "Critical item low", detail: "IV saline stock is below threshold." }
        ]
      },
      {
        persona: "executive",
        title: "Operations Resilience Dashboard",
        purpose: "Show whether supply automation is helping or hurting operations.",
        cards: [
          { title: "Shortage detection", value: "15m", detail: "Time from signal to assignment." },
          { title: "Approved actions", value: "1", detail: "No unsafe write attempts escaped." },
          { title: "On-time recovery", value: "88%", detail: "Pilot recovery metric." }
        ],
        trends: [
          { label: "Open shortage tickets", unit: "count", series: [8, 7, 6, 5, 4] },
          { label: "Mean time to assign", unit: "min", series: [19, 17, 16, 14, 15] }
        ],
        alerts: [
          { severity: "info", title: "Resilience improving", detail: "Duplicate escalations remain at zero." }
        ]
      }
    ],
    screenshotReferences: [
      { id: "supply-projects", title: "Project packs", path: "docs/assets/screenshots/commercial-projects.png", note: "Use the pack selection and run flow." },
      { id: "supply-workflow", title: "Workflow designer", path: "docs/assets/screenshots/commercial-workflow.png", note: "Shows the operational route." },
      { id: "supply-admin", title: "Admin console", path: "docs/assets/screenshots/commercial-admin.png", note: "Useful for user and release controls." }
    ]
  },
  "clinical-quality-signal": {
    settingsChecklist: [
      { settingId: "purpose-of-use", label: "Purpose of use", required: true, safeDefault: "quality-review", why: "Prevents unauthorized chart access.", impact: "critical" },
      { settingId: "notify-approval", label: "Notification approval", required: true, safeDefault: "required-for-live", why: "Requires clinician review before messaging.", impact: "critical" },
      { settingId: "redaction", label: "PHI redaction", required: true, safeDefault: "automatic", why: "Strips sensitive details from summaries.", impact: "critical" },
      { settingId: "retention", label: "Retention", required: true, safeDefault: "minimum-necessary", why: "Limits how long ePHI artifacts are kept.", impact: "high" }
    ],
    dailyPlaybook: [
      { step: 1, title: "Quality scan", operatorRole: "Quality analyst", action: "Inspect FHIR-derived quality signals.", successSignal: "Signals are scored and ranked.", caution: "Do not broaden to non-approved encounters." },
      { step: 2, title: "Case review", operatorRole: "Clinician reviewer", action: "Review the candidate case in simulation.", successSignal: "Draft case summary is ready.", caution: "Simulation output is not patient communication." },
      { step: 3, title: "Outbound communication", operatorRole: "Approver", action: "Approve live notification only when clinically appropriate.", successSignal: "One approved message is sent and audited.", caution: "Reject if the patient identity is uncertain." },
      { step: 4, title: "Committee export", operatorRole: "Quality director", action: "Export evidence for committee review.", successSignal: "Export is redacted and linked to evidence.", caution: "Never export raw identifiers." }
    ],
    scenarioGuides: [
      { scenarioId: "clinical-sim", title: "Quality scoring", useCase: "Score patient quality signals in simulation.", inputSummary: "EPHI, medium risk, simulation.", outcome: "ALLOW with redacted draft.", humanApproval: "none", dashboardView: "Clinical dashboard highlights quality trends." },
      { scenarioId: "clinical-live", title: "Care-team notification", useCase: "Send a live patient-impacting notification.", inputSummary: "PHI, high risk, live.", outcome: "REQUIRE_APPROVAL.", humanApproval: "approval", dashboardView: "Approval queue and patient safety dashboard update." },
      { scenarioId: "clinical-zero", title: "Unsafe zero-retention bypass", useCase: "Try to route ePHI without zero-retention.", inputSummary: "EPHI, high risk, live, no zero-retention.", outcome: "DENY.", humanApproval: "none", dashboardView: "Dashboard shows blocked sensitive-path attempt." }
    ],
    personaDashboards: [
      {
        persona: "clinician",
        title: "Clinical Quality Dashboard",
        purpose: "See which cases need review and which have been approved.",
        cards: [
          { title: "High-risk signals", value: "3", detail: "Requires review." },
          { title: "Approved notifications", value: "1", detail: "Sent with evidence." },
          { title: "Blocked unsafe routes", value: "1", detail: "Zero-retention bypass denied." }
        ],
        trends: [
          { label: "Quality lead time", unit: "days", series: [6, 5, 4, 3, 3] },
          { label: "Approved reviews", unit: "count", series: [2, 3, 3, 4, 5] }
        ],
        alerts: [
          { severity: "critical", title: "Notification pending approval", detail: "Patient-impacting message cannot be sent yet." }
        ]
      },
      {
        persona: "executive",
        title: "Quality Governance Dashboard",
        purpose: "Track safety improvements and evidence completeness.",
        cards: [
          { title: "Trace completeness", value: "100%", detail: "Every quality action has lineage." },
          { title: "Open escalations", value: "2", detail: "Currently under review." },
          { title: "Blocked unsafe attempts", value: "1", detail: "Zero-retention bypass prevented." }
        ],
        trends: [
          { label: "Escalation lead time", unit: "hrs", series: [20, 18, 16, 14, 12] },
          { label: "Quality signals", unit: "count", series: [9, 8, 7, 7, 6] }
        ],
        alerts: [
          { severity: "info", title: "Committee pack ready", detail: "Evidence is ready for review." }
        ]
      }
    ],
    screenshotReferences: [
      { id: "clinical-simulation", title: "Simulation Lab", path: "docs/assets/screenshots/commercial-simulation.png", note: "Shows simulation-first practice." },
      { id: "clinical-identity", title: "Identity console", path: "docs/assets/screenshots/commercial-identity.png", note: "Shows role and assurance management." },
      { id: "clinical-incidents", title: "Incident review", path: "docs/assets/screenshots/commercial-incidents.png", note: "Shows blocked routes and incident detail." }
    ]
  },
  "board-risk-cockpit": {
    settingsChecklist: [
      { settingId: "publication", label: "Publication gate", required: true, safeDefault: "approval-required", why: "Prevents unreviewed board publications.", impact: "critical" },
      { settingId: "evidence-links", label: "Evidence links", required: true, safeDefault: "mandatory", why: "Forces every claim to cite evidence.", impact: "critical" },
      { settingId: "disclosure", label: "Disclosure scope", required: true, safeDefault: "board-only", why: "Keeps material from leaking outside the board audience.", impact: "critical" },
      { settingId: "refresh-window", label: "Refresh window", required: true, safeDefault: "daily", why: "Creates a predictable governance cycle.", impact: "medium" }
    ],
    dailyPlaybook: [
      { step: 1, title: "Morning brief", operatorRole: "Risk manager", action: "Check overnight risk updates and board-ready claims.", successSignal: "Claims have evidence refs.", caution: "Do not publish until approvals are complete." },
      { step: 2, title: "Board pack prep", operatorRole: "Executive assistant", action: "Compile the report and check redaction state.", successSignal: "Draft pack is board-only.", caution: "No external shares." },
      { step: 3, title: "Approval", operatorRole: "Approver", action: "Review the final package and approve publication.", successSignal: "One approved board package is published.", caution: "Reject if a claim lacks evidence." },
      { step: 4, title: "After-action review", operatorRole: "Auditor", action: "Trace published claims back to source data.", successSignal: "Every claim resolves to an evidence ID.", caution: "Never edit the published package." }
    ],
    scenarioGuides: [
      { scenarioId: "board-sim", title: "Board brief draft", useCase: "Assemble the board pack in simulation.", inputSummary: "CONFIDENTIAL, medium risk, simulation.", outcome: "ALLOW with draft package.", humanApproval: "none", dashboardView: "Executive dashboard shows draft status and evidence refs." },
      { scenarioId: "board-live", title: "Board publish", useCase: "Publish board package to the governed repository.", inputSummary: "CONFIDENTIAL, high risk, live.", outcome: "REQUIRE_APPROVAL.", humanApproval: "approval", dashboardView: "Board dashboard shows approval and publication state." },
      { scenarioId: "board-external", title: "External distribution block", useCase: "Attempt to send board materials externally.", inputSummary: "CONFIDENTIAL, critical risk, live.", outcome: "DENY.", humanApproval: "none", dashboardView: "Alert shows disclosure-control block." }
    ],
    personaDashboards: [
      {
        persona: "executive",
        title: "Board Risk Dashboard",
        purpose: "Show what the board needs to know, not raw operational noise.",
        cards: [
          { title: "Board claims ready", value: "7", detail: "Each has evidence references." },
          { title: "Pending approval", value: "1", detail: "Waiting to publish." },
          { title: "Disclosure blocks", value: "1", detail: "External share denied." }
        ],
        trends: [
          { label: "Board cycle time", unit: "days", series: [8, 7, 6, 5, 4] },
          { label: "Evidence-backed claims", unit: "%", series: [90, 92, 95, 98, 100] }
        ],
        alerts: [
          { severity: "warning", title: "Publish pending", detail: "Board package is waiting for approval." }
        ]
      },
      {
        persona: "auditor",
        title: "Board Evidence Dashboard",
        purpose: "Trace claims back to source events and approval state.",
        cards: [
          { title: "Evidence chains", value: "100%", detail: "Every claim linked." },
          { title: "Blocked disclosures", value: "1", detail: "Logged and investigated." },
          { title: "Review complete", value: "Daily", detail: "Fresh pack cadence." }
        ],
        trends: [
          { label: "Open findings", unit: "count", series: [3, 2, 2, 1, 1] },
          { label: "Claim coverage", unit: "%", series: [84, 88, 91, 96, 100] }
        ],
        alerts: [
          { severity: "info", title: "Evidence complete", detail: "Published claims are audit-ready." }
        ]
      }
    ],
    screenshotReferences: [
      { id: "board-dashboard", title: "Business dashboard", path: "docs/assets/screenshots/commercial-dashboard.png", note: "Shows executive outcome metrics." },
      { id: "board-audit", title: "Audit explorer", path: "docs/assets/screenshots/commercial-audit.png", note: "Shows claim provenance." },
      { id: "board-readiness", title: "Readiness view", path: "docs/assets/screenshots/commercial-readiness.png", note: "Shows buyer-facing proof and scorecard." }
    ]
  }
};

const projectPackPolicyPresets: Record<ProjectPackId, ProjectPackPolicyPreset> = {
  "secops-runtime-guard": {
    profileName: "SecOps Trust Baseline",
    changeSummary: "Apply secure baseline for SecOps Runtime Guard demonstration.",
    controls: {
      enforceSecretDeny: true,
      requireApprovalForHighRiskLive: true,
      requireDlpOnOutbound: true,
      restrictExternalProvidersToZeroRetention: true,
      maxToolCallsPerExecution: 6
    }
  },
  "revenue-cycle-copilot": {
    profileName: "Revenue Cycle Safe Baseline",
    changeSummary: "Apply secure baseline for Revenue Cycle Copilot demonstration.",
    controls: {
      requireZeroRetentionForPhi: true,
      requireApprovalForHighRiskLive: true,
      requireDlpOnOutbound: true,
      restrictExternalProvidersToZeroRetention: true,
      maxToolCallsPerExecution: 7
    }
  },
  "supply-chain-resilience": {
    profileName: "Supply Chain Guardrail Baseline",
    changeSummary: "Apply secure baseline for Supply Chain Resilience demonstration.",
    controls: {
      requireApprovalForHighRiskLive: true,
      requireDlpOnOutbound: true,
      maxToolCallsPerExecution: 6
    }
  },
  "clinical-quality-signal": {
    profileName: "Clinical Quality Safe Baseline",
    changeSummary: "Apply secure baseline for Clinical Quality Signal demonstration.",
    controls: {
      requireZeroRetentionForPhi: true,
      requireApprovalForHighRiskLive: true,
      requireDlpOnOutbound: true,
      restrictExternalProvidersToZeroRetention: true,
      maxToolCallsPerExecution: 6
    }
  },
  "board-risk-cockpit": {
    profileName: "Board Reporting Governance Baseline",
    changeSummary: "Apply secure baseline for Board Risk Cockpit demonstration.",
    controls: {
      requireApprovalForHighRiskLive: true,
      requireDlpOnOutbound: true,
      maxToolCallsPerExecution: 6
    }
  }
};

const isProjectPackId = (packId: string): packId is ProjectPackId =>
  projectPacks.some((pack) => pack.packId === packId);

export const listProjectPacks = (): ProjectPackDefinition[] => projectPacks.slice();
export const getProjectPack = (packId: string): ProjectPackDefinition | undefined =>
  projectPacks.find((pack) => pack.packId === packId);

export const getProjectPackExperience = (packId: string): ProjectPackDetailedExperience | undefined => {
  if (!isProjectPackId(packId)) return undefined;
  return {
    ...projectPackExperiences[packId],
    ...projectPackDeepMaterials[packId]
  };
};

export const getProjectPackPolicyPreset = (packId: string): ProjectPackPolicyPreset | undefined => {
  if (!isProjectPackId(packId)) return undefined;
  return projectPackPolicyPresets[packId];
};

export const getProjectPackSettingsChecklist = (packId: string): ProjectPackSettingsChecklistItem[] | undefined => {
  const experience = getProjectPackExperience(packId);
  return experience?.settingsChecklist;
};

export const getProjectPackDailyPlaybook = (packId: string): ProjectPackDailyPlaybookEntry[] | undefined => {
  const experience = getProjectPackExperience(packId);
  return experience?.dailyPlaybook;
};

export const getProjectPackDashboards = (packId: string): ProjectPackPersonaDashboard[] | undefined => {
  const experience = getProjectPackExperience(packId);
  return experience?.personaDashboards;
};
