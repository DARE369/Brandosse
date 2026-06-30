import React, { useMemo, useState } from "react";
import { formatShortDateTime } from "../utils/formatDate";

const INITIAL_VISIBLE_NOTES = 5;

export default function AdminNotesPanel({
  notes,
  busy,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const visibleNotes = useMemo(
    () => (showAll ? notes : notes.slice(0, INITIAL_VISIBLE_NOTES)),
    [notes, showAll],
  );

  const activeNote = notes.find((note) => note.id === editingId) || null;

  const resetEditor = () => {
    setDraft("");
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!draft.trim()) return;
    if (editingId) {
      const updated = await onUpdate(editingId, draft.trim());
      if (updated) resetEditor();
      return;
    }

    const created = await onAdd(draft.trim());
    if (created) resetEditor();
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <h3>Internal Notes</h3>
          <p className="admin-page-subtext">Admin-only notes with timestamps. These are never visible to the user.</p>
        </div>
        <button
          type="button"
          className="admin-secondary-button"
          onClick={() => {
            if (editingId) {
              resetEditor();
              return;
            }
            setDraft("");
            setEditingId("new");
          }}
        >
          {editingId ? "Cancel" : "+ Add Note"}
        </button>
      </div>

      {editingId ? (
        <div className="admin-modal-section">
          <textarea
            className="admin-textarea"
            rows="6"
            maxLength={2000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a private note for this user"
          />
          <div className="admin-header-actions">
            <span className="admin-field-footnote">{draft.length}/2000</span>
            <button type="button" className="admin-primary-button" onClick={handleSubmit} disabled={busy || !draft.trim()}>
              {busy ? "Saving..." : editingId === "new" ? "Save Note" : "Update Note"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-list-stack">
        {visibleNotes.length ? visibleNotes.map((note) => (
          <article key={note.id} className="admin-note-card">
            <div className="admin-note-card-top">
              <div>
                <strong>{note.author?.full_name || note.author?.email || "Admin"}</strong>
                <span>{formatShortDateTime(note.created_at)}</span>
              </div>
              <div className="admin-header-actions">
                <button
                  type="button"
                  className="admin-inline-button"
                  onClick={() => {
                    setEditingId(note.id);
                    setDraft(note.body || "");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="admin-inline-button"
                  onClick={() => onDelete(note)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="admin-longform">{note.body}</p>
          </article>
        )) : (
          <div className="admin-empty-inline">No internal notes yet.</div>
        )}
      </div>

      {notes.length > INITIAL_VISIBLE_NOTES ? (
        <button type="button" className="admin-subtle-link" onClick={() => setShowAll((current) => !current)}>
          {showAll ? "Hide older notes" : "Show older notes"}
        </button>
      ) : null}
    </section>
  );
}
