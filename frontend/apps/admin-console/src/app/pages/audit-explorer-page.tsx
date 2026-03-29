import { useMemo, useState } from "react";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, JsonBlock, Panel, PageHeader, Table } from "../ui.js";

const formatTime = (value: string) => new Date(value).toLocaleString();

export const AuditExplorerPage = () => {
  const auditEvents = usePilotWorkspace((state) => state.auditEvents);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(auditEvents[0]?.eventId);

  const selectedEvent = useMemo(
    () => auditEvents.find((event) => event.eventId === selectedEventId) ?? auditEvents[0],
    [auditEvents, selectedEventId]
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Evidence"
        title="Audit Explorer"
        subtitle="Every major action emits a replayable audit event with an evidence reference."
        actions={<Badge tone="info">{auditEvents.length} events</Badge>}
      />

      <section className="split-grid">
        <Panel title="Event log" subtitle="The latest events arrive in reverse chronological order from the pilot backend.">
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Action</th>
                <th>Status</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((event) => (
                <tr
                  key={event.eventId}
                  className={event.eventId === selectedEvent?.eventId ? "selected-row" : ""}
                  onClick={() => setSelectedEventId(event.eventId)}
                >
                  <td>{formatTime(event.timestamp)}</td>
                  <td>{event.category}</td>
                  <td>{event.action}</td>
                  <td>
                    <Badge tone={event.status === "success" ? "success" : event.status === "blocked" ? "warning" : "danger"}>
                      {event.status}
                    </Badge>
                  </td>
                  <td>{event.evidenceId}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Event detail" subtitle="JSON view for investigators and compliance reviewers.">
          {selectedEvent ? (
            <>
              <div className="pill-row">
                <Badge tone="info">{selectedEvent.category}</Badge>
                <Badge tone={selectedEvent.status === "success" ? "success" : "warning"}>{selectedEvent.status}</Badge>
              </div>
              <div className="audit-detail">
                <strong>{selectedEvent.action}</strong>
                <p>{formatTime(selectedEvent.timestamp)}</p>
              </div>
              <JsonBlock value={selectedEvent.details} />
            </>
          ) : (
            <p className="muted">No audit event selected.</p>
          )}
        </Panel>
      </section>
    </div>
  );
};

