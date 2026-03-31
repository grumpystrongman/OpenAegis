import { useMemo, useState } from "react";
import type { UserRole } from "../../shared/auth/session.js";
import { usePilotWorkspace } from "../pilot-workspace.js";
import { Badge, KeyValueList, Panel, PageHeader, Table } from "../ui.js";

const AVAILABLE_ROLES: Array<{
  role: UserRole;
  label: string;
  hint: string;
}> = [
  { role: "platform_admin", label: "Platform admin", hint: "Can configure core tenant settings and release controls." },
  { role: "security_admin", label: "Security admin", hint: "Can change policy and incident controls." },
  { role: "workflow_operator", label: "Workflow operator", hint: "Can run workflows and simulation scenarios." },
  { role: "approver", label: "Approver", hint: "Can approve high-risk actions after review." },
  { role: "auditor", label: "Auditor", hint: "Can inspect immutable audit evidence and replay traces." },
  { role: "analyst", label: "Analyst", hint: "Can view dashboards and outcome metrics." }
];

interface UserDraft {
  userId: string;
  displayName: string;
  email: string;
  assuranceLevel: "aal1" | "aal2" | "aal3";
  roles: UserRole[];
}

const EMPTY_DRAFT: UserDraft = {
  userId: "",
  displayName: "",
  email: "",
  assuranceLevel: "aal2",
  roles: ["analyst"]
};

const statusTone = (status: "active" | "disabled") => (status === "active" ? "success" : "warning");
const roleLabel = (role: string) => AVAILABLE_ROLES.find((entry) => entry.role === role)?.label ?? role;
const normalizeRoles = (roles: UserRole[]) => Array.from(new Set(roles)).sort();
const draftSignature = (draft: UserDraft) =>
  JSON.stringify({
    displayName: draft.displayName.trim(),
    email: draft.email.trim().toLowerCase(),
    assuranceLevel: draft.assuranceLevel,
    roles: normalizeRoles(draft.roles)
  });

const evaluateRisk = (roles: UserRole[], assuranceLevel: "aal1" | "aal2" | "aal3") => {
  const notes: Array<{ level: "danger" | "warning" | "info"; text: string }> = [];
  if (roles.length === 0) {
    notes.push({
      level: "warning",
      text: "This user has no role assigned and will not be able to use the platform."
    });
  }
  if (roles.includes("approver") && assuranceLevel !== "aal3") {
    notes.push({
      level: "danger",
      text: "Approver role should use AAL3 to reduce account takeover risk."
    });
  }
  if (roles.includes("platform_admin") && roles.includes("security_admin") && assuranceLevel !== "aal3") {
    notes.push({
      level: "danger",
      text: "Combined admin privileges require AAL3 for least-risk operation."
    });
  }
  if (roles.includes("workflow_operator") && roles.includes("approver")) {
    notes.push({
      level: "warning",
      text: "Separation of duties is recommended: operator and approver should usually be different people."
    });
  }
  if (notes.length === 0) {
    notes.push({
      level: "info",
      text: "Role and assurance choices are aligned with default governance safeguards."
    });
  }
  return notes;
};

export const IdentityAccessPage = () => {
  const directoryUsers = usePilotWorkspace((state) => state.directoryUsers);
  const saveDirectoryUser = usePilotWorkspace((state) => state.saveDirectoryUser);
  const setDirectoryUserStatus = usePilotWorkspace((state) => state.setDirectoryUserStatus);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => directoryUsers.find((user) => user.userId === selectedUserId),
    [directoryUsers, selectedUserId]
  );
  const mode = selectedUser ? "editing" : "creating";

  const baselineDraft = useMemo<UserDraft>(() => {
    if (!selectedUser) return EMPTY_DRAFT;
    return {
      userId: selectedUser.userId,
      displayName: selectedUser.displayName,
      email: selectedUser.email,
      assuranceLevel: selectedUser.assuranceLevel,
      roles: selectedUser.roles.filter((role): role is UserRole => AVAILABLE_ROLES.some((entry) => entry.role === role))
    };
  }, [selectedUser]);

  const isValid = draft.displayName.trim().length > 0 && draft.email.includes("@") && draft.roles.length > 0;
  const isDirty = draftSignature(draft) !== draftSignature(baselineDraft);
  const riskNotes = evaluateRisk(draft.roles, draft.assuranceLevel);

  const roleCounts = useMemo(
    () =>
      AVAILABLE_ROLES.map((entry) => ({
        role: entry.role,
        count: directoryUsers.filter((user) => user.status === "active" && user.roles.includes(entry.role)).length
      })),
    [directoryUsers]
  );

  const loadUser = (userId: string) => {
    const user = directoryUsers.find((item) => item.userId === userId);
    if (!user) return;
    setSelectedUserId(userId);
    setDraft({
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
      assuranceLevel: user.assuranceLevel,
      roles: user.roles.filter((role): role is UserRole => AVAILABLE_ROLES.some((entry) => entry.role === role))
    });
    setNotice(null);
  };

  const resetDraft = () => {
    setSelectedUserId(null);
    setDraft(EMPTY_DRAFT);
    setNotice("Creating a new user profile.");
  };

  const toggleRole = (role: UserRole, checked: boolean) => {
    setDraft((previous) => ({
      ...previous,
      roles: checked ? Array.from(new Set([...previous.roles, role])) : previous.roles.filter((item) => item !== role)
    }));
  };

  const saveUser = () => {
    setNotice(null);
    if (!isValid) {
      setNotice("Complete display name, email, and at least one role.");
      return;
    }
    if (!isDirty) {
      setNotice("No changes to save.");
      return;
    }
    saveDirectoryUser({
      ...(draft.userId ? { userId: draft.userId } : {}),
      displayName: draft.displayName.trim(),
      email: draft.email.trim().toLowerCase(),
      roles: normalizeRoles(draft.roles),
      assuranceLevel: draft.assuranceLevel
    });
    setNotice(`Saved ${draft.displayName}.`);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Identity plane"
        title="Identity & Access"
        subtitle="Simple user administration with role hints, risk warnings, and safe defaults."
        actions={
          <>
            <Badge tone="info">SSO-ready directory model</Badge>
            <Badge tone={mode === "editing" ? "warning" : "success"}>{mode}</Badge>
            <button type="button" onClick={resetDraft}>
              New user
            </button>
            <button type="button" className="primary" onClick={saveUser} disabled={!isValid || !isDirty}>
              Save user
            </button>
          </>
        }
      />

      {notice ? <div className="banner info">{notice}</div> : null}

      <section className="split-grid">
        <Panel title="Directory overview" subtitle="Open a user in editor. Disable users instantly when needed.">
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Assurance</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {directoryUsers.map((user) => (
                <tr key={user.userId} className={selectedUserId === user.userId ? "selected-row" : ""}>
                  <td>
                    <button type="button" className="link-button" onClick={() => loadUser(user.userId)}>
                      {user.displayName}
                    </button>
                    <div className="muted">{user.email}</div>
                  </td>
                  <td>{user.assuranceLevel.toUpperCase()}</td>
                  <td>
                    <div className="pill-row">
                      {user.roles.map((role) => (
                        <Badge key={role} tone="info">
                          {roleLabel(role)}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        if (user.status === "active" && (user.roles.includes("platform_admin") || user.roles.includes("security_admin"))) {
                          if (typeof window !== "undefined") {
                            const confirmed = window.confirm(
                              "This user has administrative privileges. Confirm disable action."
                            );
                            if (!confirmed) return;
                          }
                        }
                        setDirectoryUserStatus(user.userId, user.status === "active" ? "disabled" : "active");
                        setNotice(`${user.displayName} is now ${user.status === "active" ? "disabled" : "active"}.`);
                      }}
                    >
                      {user.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="User editor" subtitle="Role hints explain what each permission does before you assign it.">
          <div className="policy-editor-grid">
            <label className="form-field">
              <span>Display name</span>
              <input
                value={draft.displayName}
                onChange={(event) => setDraft((previous) => ({ ...previous, displayName: event.target.value }))}
                placeholder="Ex: Alex Carter"
              />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input
                value={draft.email}
                onChange={(event) => setDraft((previous) => ({ ...previous, email: event.target.value }))}
                placeholder="alex@hospital.org"
              />
            </label>
            <label className="form-field">
              <span>Assurance level</span>
              <select
                value={draft.assuranceLevel}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    assuranceLevel: event.target.value as "aal1" | "aal2" | "aal3"
                  }))
                }
              >
                <option value="aal1">AAL1</option>
                <option value="aal2">AAL2</option>
                <option value="aal3">AAL3</option>
              </select>
            </label>
          </div>
          <div className="policy-control-list">
            {AVAILABLE_ROLES.map((entry) => (
              <label key={entry.role} className="policy-toggle">
                <div>
                  <strong>{entry.label}</strong>
                  <p>{entry.hint}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.roles.includes(entry.role)}
                  onChange={(event) => toggleRole(entry.role, event.target.checked)}
                />
              </label>
            ))}
          </div>
          {selectedUser ? (
            <div className="muted">
              Editing {selectedUser.displayName}. Last updated {new Date(selectedUser.updatedAt).toLocaleString()}.
            </div>
          ) : (
            <div className="muted">New users default to active status and current tenant scope.</div>
          )}
        </Panel>
      </section>

      <section className="split-grid">
        <Panel title="Impact warnings" subtitle="The system highlights risky combinations before you save changes.">
          <div className="stack">
            {riskNotes.map((note) => (
              <div key={note.text} className="hint-row">
                <Badge tone={note.level === "danger" ? "danger" : note.level === "warning" ? "warning" : "info"}>
                  {note.level}
                </Badge>
                <span>{note.text}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Role distribution" subtitle="Active role coverage for this tenant directory.">
          <KeyValueList
            items={roleCounts.map((entry) => ({
              label: roleLabel(entry.role),
              value: `${entry.count} active user${entry.count === 1 ? "" : "s"}`
            }))}
          />
        </Panel>
      </section>
    </div>
  );
};
