import { useMemo, useState } from "react";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, JsonBlock, Panel, PageHeader } from "../ui.js";

const formatTime = (value: string) => new Date(value).toLocaleString();

export const IncidentReviewPage = () => {
  const incidents = usePilotWorkspace((state) => state.incidents);
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | undefined>(incidents[0]?.incidentId);

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.incidentId === selectedIncidentId) ?? incidents[0],
    [incidents, selectedIncidentId]
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Investigation"
        title="Incident Review Explorer"
        subtitle="Incidents are derived from blocked executions, rejected approvals, and blocked audit events."
        actions={<Badge tone="warning">{incidents.length} derived incidents</Badge>}
      />

      <section className="split-grid">
        <Panel title="Incident queue" subtitle="The current queue is driven by live pilot state, not mocked content.">
          <div className="incident-list">
            {incidents.length > 0 ? (
              incidents.map((incident) => (
                <button
                  key={incident.incidentId}
                  type="button"
                  className={incident.incidentId === selectedIncident?.incidentId ? "incident-item active" : "incident-item"}
                  onClick={() => setSelectedIncidentId(incident.incidentId)}
                >
                  <div className="incident-top">
                    <strong>{incident.title}</strong>
                    <Badge
                      tone={incident.severity === "critical" ? "danger" : incident.severity === "high" ? "warning" : "info"}
                    >
                      {incident.severity}
                    </Badge>
                  </div>
                  <p>{incident.summary}</p>
                  <div className="incident-foot">
                    <span>{incident.source}</span>
                    <span>{formatTime(incident.detectedAt)}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <strong>No incidents detected</strong>
                <p>Run a live workflow and reject an approval to populate the incident explorer.</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Incident detail" subtitle="Everything needed for investigation, remediation, and replay.">
          {selectedIncident ? (
            <>
              <div className="pill-row">
                <Badge tone={selectedIncident.severity === "critical" ? "danger" : "warning"}>{selectedIncident.severity}</Badge>
                <Badge tone="info">{selectedIncident.status}</Badge>
                <Badge tone="default">{selectedIncident.source}</Badge>
              </div>
              <div className="incident-summary">
                <strong>{selectedIncident.summary}</strong>
                <p>{selectedIncident.recommendation}</p>
              </div>
              <div className="incident-meta">
                <div>
                  <span className="incident-label">Execution</span>
                  <strong>{selectedIncident.executionId ?? "n/a"}</strong>
                </div>
                <div>
                  <span className="incident-label">Approval</span>
                  <strong>{selectedIncident.approvalId ?? "n/a"}</strong>
                </div>
                <div>
                  <span className="incident-label">Evidence</span>
                  <strong>{selectedIncident.evidenceId}</strong>
                </div>
              </div>
              <div className="timeline">
                {selectedIncident.timeline.map((entry) => (
                  <article key={`${entry.label}-${entry.at}`} className="timeline-entry">
                    <strong>{entry.label}</strong>
                    <span>{formatTime(entry.at)}</span>
                    <p>{entry.detail}</p>
                  </article>
                ))}
              </div>
              <div className="panel-subsection">
                <strong>Signals</strong>
                <div className="pill-row">
                  {selectedIncident.signals.map((signal) => (
                    <Badge key={signal} tone="info">
                      {signal}
                    </Badge>
                  ))}
                </div>
              </div>
              <JsonBlock value={selectedIncident} />
            </>
          ) : (
            <p className="muted">No incident selected.</p>
          )}
        </Panel>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Supporting audit trail</h3>
            <p className="panel-subtitle">Linked events used to derive incidents and validate remediation.</p>
          </div>
        </div>
        <div className="audit-strip">
          {auditEvents.slice(0, 5).map((event) => (
            <article key={event.eventId} className="audit-strip-card">
              <strong>{event.action}</strong>
              <p>{event.category}</p>
              <span>{event.status}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
