import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, KeyValueList, Panel, PageHeader } from "../ui.js";

const formatTime = (value?: string) => (value ? new Date(value).toLocaleString() : "n/a");

export const WorkflowDesignerPage = () => {
  const latestExecution = usePilotWorkspace((state) => state.executions[0]);
  const approvals = usePilotWorkspace((state) => state.approvals);

  const workflow = pilotWorkspaceBlueprint.workflows[0]!;
  const latestOutput = latestExecution?.output ?? {
    summary: "No runtime snapshot yet.",
    recommendation: "Use the simulation lab to generate a workflow execution.",
    riskFlags: [] as string[]
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Process design"
        title="Workflow Designer"
        subtitle="The discharge workflow is laid out as a deterministic step chain with control points and approval gates."
        actions={<Badge tone="info">{workflow.workflowId}</Badge>}
      />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{workflow.name}</h3>
            <p className="panel-subtitle">{workflow.objective}</p>
          </div>
        </div>
        <div className="workflow-lane">
          {workflow.steps.map((step, index) => (
            <article key={step.id} className="workflow-step">
              <div className="workflow-step-index">{index + 1}</div>
              <strong>{step.title}</strong>
              <p>{step.actor}</p>
              <span>{step.control}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="split-grid">
        <Panel title="Workflow metadata" subtitle="The orchestration engine keeps this structure deterministic and replayable.">
          <KeyValueList
            items={[
              { label: "Trigger", value: workflow.trigger },
              { label: "Classification", value: workflow.classification },
              { label: "High-risk step", value: workflow.highRiskStep },
              { label: "Live approvals", value: approvals.length },
              { label: "Last execution", value: latestExecution ? latestExecution.executionId : "none" }
            ]}
          />
        </Panel>

        <Panel title="Runtime checkpoint" subtitle="The current workflow state mirrors the latest execution snapshot.">
          {latestExecution ? (
            <>
              <div className="pill-row">
                <Badge tone={latestExecution.status === "blocked" ? "warning" : "success"}>{latestExecution.status}</Badge>
                <Badge tone="info">{latestExecution.currentStep}</Badge>
                <Badge tone="default">{latestExecution.mode}</Badge>
              </div>
              <KeyValueList
                items={[
                  { label: "Execution ID", value: latestExecution.executionId },
                  { label: "Approval", value: latestExecution.approvalId ?? "none" },
                  { label: "Updated", value: formatTime(latestExecution.updatedAt) }
                ]}
              />
              <div className="execution-summary">
                <strong>{latestOutput.summary}</strong>
                <p>{latestOutput.recommendation}</p>
              </div>
            </>
          ) : (
            <p className="muted">Use the simulation lab to generate the first runtime snapshot.</p>
          )}
        </Panel>
      </section>
    </div>
  );
};
