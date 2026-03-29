import { pilotWorkspaceBlueprint, usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, JsonBlock, KeyValueList, Panel, PageHeader } from "../ui.js";

export const AgentBuilderPage = () => {
  const latestExecution = usePilotWorkspace((state) => state.executions[0]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Authoring"
        title="Agent Builder"
        subtitle="Predefined agents for the pilot, each with explicit sandbox, tool scope, and execution budget constraints."
        actions={
          <>
            <Badge tone="info">Signed manifests only</Badge>
            <Badge tone="warning">No default network access</Badge>
          </>
        }
      />

      <section className="split-grid">
        {pilotWorkspaceBlueprint.agents.map((agent) => (
          <Panel key={agent.agentId} title={agent.name} subtitle={agent.purpose} tone={agent.sandboxProfile === "egress-deny" ? "warning" : "info"}>
            <KeyValueList
              items={[
                { label: "Agent ID", value: agent.agentId },
                { label: "Owner", value: agent.owner },
                { label: "Sandbox", value: agent.sandboxProfile },
                { label: "Step limit", value: agent.budget.stepLimit },
                { label: "Runtime", value: `${agent.budget.maxRuntimeSeconds}s` },
                { label: "Retries", value: agent.budget.retryLimit }
              ]}
            />
            <div className="pill-row">
              {agent.toolScopes.map((scope) => (
                <Badge key={scope} tone="default">
                  {scope}
                </Badge>
              ))}
            </div>
          </Panel>
        ))}
      </section>

      <section className="split-grid">
        <Panel title="Signed manifest preview" subtitle="This is the shape that would be stored in the registry.">
          <JsonBlock
            value={{
              workflowId: pilotWorkspaceBlueprint.useCase.workflowId,
              agents: pilotWorkspaceBlueprint.agents.map((agent) => ({
                agentId: agent.agentId,
                sandboxProfile: agent.sandboxProfile,
                toolScopes: agent.toolScopes,
                budget: agent.budget
              }))
            }}
          />
        </Panel>

        <Panel title="Last runtime checkpoint" subtitle="The agent builder can replay the most recent execution snapshot.">
          {latestExecution ? (
            <>
              <KeyValueList
                items={[
                  { label: "Execution", value: latestExecution.executionId },
                  { label: "Step", value: latestExecution.currentStep },
                  { label: "Mode", value: latestExecution.mode },
                  { label: "Status", value: latestExecution.status },
                  { label: "Approval", value: latestExecution.approvalId ?? "none" }
                ]}
              />
              <div className="execution-summary">
                <strong>Tool calls</strong>
                <div className="pill-row">
                  {latestExecution.toolCalls.map((toolCall) => (
                    <Badge key={toolCall} tone="info">
                      {toolCall}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="muted">Run the simulation lab first to populate the checkpoint view.</p>
          )}
        </Panel>
      </section>
    </div>
  );
};

