import { useMemo, useState } from "react";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, EmptyState, KeyValueList, Panel, PageHeader, Table } from "../ui.js";

const formatTime = (value: string) => new Date(value).toLocaleString();

export const ApprovalInboxPage = () => {
  const approvals = usePilotWorkspace((state) => state.approvals);
  const decideApproval = usePilotWorkspace((state) => state.decideApproval);
  const isSyncing = usePilotWorkspace((state) => state.isSyncing);
  const connectDemoUsers = usePilotWorkspace((state) => state.connectDemoUsers);
  const securitySession = usePilotWorkspace((state) => state.securitySession);

  const [selectedApprovalId, setSelectedApprovalId] = useState<string | undefined>(approvals[0]?.approvalId);

  const selectedApproval = useMemo(
    () => approvals.find((approval) => approval.approvalId === selectedApprovalId) ?? approvals[0],
    [approvals, selectedApprovalId]
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Human control"
        title="Approval Inbox"
        subtitle="High-risk and live actions pause here until the reviewer explicitly approves or rejects them."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
              {securitySession ? "Reconnect sessions" : "Connect sessions"}
            </button>
          </>
        }
      />

      {approvals.length === 0 ? (
        <Panel title="No approvals yet" subtitle="Run a live workflow to create a queued review item.">
          <EmptyState
            title="Inbox empty"
            description="The pilot backend only generates approvals when a live workflow reaches the high-risk outbound step."
            action={
              <button type="button" className="primary" onClick={() => void connectDemoUsers()} disabled={isSyncing}>
                Connect demo sessions
              </button>
            }
          />
        </Panel>
      ) : (
        <section className="split-grid">
          <Panel title="Queue" subtitle="Pending items should be resolved quickly so the workflow can continue.">
            <Table>
              <thead>
                <tr>
                  <th>Approval</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Reason</th>
                  <th>Execution</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((approval) => (
                  <tr
                    key={approval.approvalId}
                    className={approval.approvalId === selectedApproval?.approvalId ? "selected-row" : ""}
                    onClick={() => setSelectedApprovalId(approval.approvalId)}
                  >
                    <td>{approval.approvalId}</td>
                    <td>
                      <Badge tone={approval.status === "pending" ? "warning" : approval.status === "approved" ? "success" : "danger"}>
                        {approval.status}
                      </Badge>
                    </td>
                    <td>{approval.riskLevel}</td>
                    <td>{approval.reason}</td>
                    <td>{approval.executionId ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Decision detail" subtitle="Approve or reject with a rationale that lands in the audit trail.">
            {selectedApproval ? (
              <>
                <KeyValueList
                  items={[
                    { label: "Approval ID", value: selectedApproval.approvalId },
                    { label: "Status", value: selectedApproval.status },
                    { label: "Risk", value: selectedApproval.riskLevel },
                    { label: "Requested by", value: selectedApproval.requestedBy },
                    { label: "Execution", value: selectedApproval.executionId ?? "n/a" },
                    { label: "Created", value: formatTime(selectedApproval.createdAt) },
                    { label: "Expires", value: formatTime(selectedApproval.expiresAt) }
                  ]}
                />
                <div className="approval-detail-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={selectedApproval.status !== "pending" || isSyncing}
                    onClick={() => void decideApproval(selectedApproval.approvalId, "approve", "Reviewer approved in EAOS approval inbox")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={selectedApproval.status !== "pending" || isSyncing}
                    onClick={() => void decideApproval(selectedApproval.approvalId, "reject", "Reviewer rejected in EAOS approval inbox")}
                  >
                    Reject
                  </button>
                </div>
                <div className="approval-history">
                  <strong>Review history</strong>
                  {(selectedApproval.approvers?.length ?? 0) > 0 ? (
                    selectedApproval.approvers.map((approver) => (
                      <div key={`${approver.approverId}-${approver.decidedAt}`} className="history-row">
                        <span>{approver.approverId}</span>
                        <span>{approver.decision}</span>
                        <span>{formatTime(approver.decidedAt)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No decisions have been recorded yet.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Select an item from the queue.</p>
            )}
          </Panel>
        </section>
      )}
    </div>
  );
};
