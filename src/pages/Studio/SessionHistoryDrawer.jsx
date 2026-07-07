"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Search, ChevronDown, ArrowUp, ArrowDown, Check } from "lucide-react";
import { Drawer, EmptyState, Button, Skeleton } from "../../ui-v2";
import styles from "./SessionHistoryDrawer.module.css";

const PROJECT_COLORS = ["#7C5CFC", "#FF4D2E", "#1C7A5A", "#C77F12", "#2563EB", "#9333EA", "#0891B2", "#059669"];
const EXPANDED_STORAGE_KEY = "studio-session-drawer-expanded";
const GENERAL_KEY = "__general__";

function initials(title = "") {
  return title.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "S";
}

function readExpanded() {
  if (typeof window === "undefined") return GENERAL_KEY;
  try {
    return window.localStorage.getItem(EXPANDED_STORAGE_KEY) || GENERAL_KEY;
  } catch {
    return GENERAL_KEY;
  }
}

function ProjectSection({
  sectionKey, name, color, count, sessions, isGeneral, expanded, onToggle,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown, onResume, onNewSession, onRequestDeleteSession,
  editingName, onStartRename, onCommitRename, onCancelRename, renameDraft, setRenameDraft,
  onRequestDeleteProject,
}) {
  return (
    <div className={[styles.section, isGeneral ? styles.sectionGeneral : ""].join(" ")}>
      <div className={styles.sectionHead} onClick={onToggle}>
        {!isGeneral && <span className={styles.sectionDot} style={{ background: color }} />}
        {editingName ? (
          <input
            className={styles.titleInput}
            style={{ flex: 1 }}
            value={renameDraft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(); if (e.key === "Escape") onCancelRename(); }}
            onBlur={onCommitRename}
          />
        ) : (
          <span className={styles.sectionName}>{name}</span>
        )}
        <span className={styles.sectionCount}>{count}</span>
        {!isGeneral && !editingName && (
          <span className={styles.sectionActions} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.iconBtn} disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move project up" title="Move up">
              <ArrowUp size={13} />
            </button>
            <button type="button" className={styles.iconBtn} disabled={!canMoveDown} onClick={onMoveDown} aria-label="Move project down" title="Move down">
              <ArrowDown size={13} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={onStartRename} aria-label="Rename project" title="Rename">
              <Pencil size={13} />
            </button>
            <button type="button" className={styles.deleteBtn} onClick={onRequestDeleteProject} aria-label="Delete project" title="Delete (sessions move to General)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </span>
        )}
        <ChevronDown size={15} className={[styles.sectionChevron, expanded ? styles.sectionChevronOpen : ""].join(" ")} />
      </div>
      {expanded && (
        <div className={styles.sectionBody}>
          {sessions.length === 0 ? (
            <div className={styles.emptySection}>No sessions here yet.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className={styles.pastRow}>
                <div className={styles.pastAvatar} onClick={() => onResume(s)}>{initials(s.title)}</div>
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onResume(s)}>
                  <div className={styles.pastTitle}>{s.title || "Untitled session"}</div>
                  <div className={styles.pastMeta}>{new Date(s.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                </div>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  aria-label="Delete session"
                  onClick={(e) => { e.stopPropagation(); onRequestDeleteSession(s); }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            ))
          )}
          <button type="button" className={styles.newSessionBtn} onClick={() => onNewSession(sectionKey === GENERAL_KEY ? null : sectionKey)}>
            <Plus size={13} aria-hidden="true" /> New session{isGeneral ? "" : ` in ${name}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Session history drawer — sessions grouped by real studio_projects
 * ("campaign folders"), with "General" (project_id = null) always pinned
 * first. Projects are user-reorderable (persisted via sort_order) and
 * rename/delete-able; deleting a project re-homes its sessions to General
 * (DB does this automatically via ON DELETE SET NULL) rather than deleting
 * them. Moving an EXISTING session between projects is deliberately not
 * implemented yet — see design-system-v2 memory for the deferred plan.
 */
export default function SessionHistoryDrawer({
  open, onClose, sessions, projects, activeSession, loading,
  onResume, onNewSession, onRenameSession, onRequestDeleteSession,
  onCreateProject, onRenameProject, onRequestDeleteProject, onReorderProjects,
}) {
  const [query, setQuery] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [expandedKey, setExpandedKey] = useState(GENERAL_KEY);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");

  useEffect(() => {
    setExpandedKey(readExpanded());
  }, []);

  const setExpanded = (key) => {
    setExpandedKey((cur) => {
      const next = cur === key ? null : key; // toggle
      try {
        window.localStorage.setItem(EXPANDED_STORAGE_KEY, next || "");
      } catch {
        /* private mode — expansion just won't persist across reloads */
      }
      return next;
    });
  };

  const q = query.trim().toLowerCase();
  const matches = (s) => !q || (s.title || "").toLowerCase().includes(q);

  const otherSessions = useMemo(
    () => (sessions || []).filter((s) => s.id !== activeSession?.id),
    [sessions, activeSession?.id]
  );
  const generalSessions = useMemo(
    () => otherSessions.filter((s) => !s.project_id && matches(s)),
    [otherSessions, q]
  );
  const sessionsByProject = useMemo(() => {
    const map = new Map();
    for (const p of projects) map.set(p.id, []);
    for (const s of otherSessions) {
      if (s.project_id && map.has(s.project_id) && matches(s)) map.get(s.project_id).push(s);
    }
    return map;
  }, [otherSessions, projects, q]);

  const startEditTitle = () => {
    setTitleDraft(activeSession?.title || "");
    setEditingTitle(true);
  };
  const commitEditTitle = () => {
    if (activeSession && titleDraft.trim()) onRenameSession(activeSession.id, titleDraft.trim());
    setEditingTitle(false);
  };

  const startRenameProject = (project) => {
    setRenamingProjectId(project.id);
    setProjectRenameDraft(project.name);
  };
  const commitRenameProject = () => {
    if (renamingProjectId && projectRenameDraft.trim()) onRenameProject(renamingProjectId, projectRenameDraft.trim());
    setRenamingProjectId(null);
  };

  const moveProject = (index, delta) => {
    const orderedIds = projects.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    onReorderProjects(orderedIds);
  };

  const submitNewProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const created = await onCreateProject(name, newProjectColor);
    setNewProjectName("");
    setNewProjectColor(PROJECT_COLORS[0]);
    setNewProjectOpen(false);
    if (created?.id) {
      setExpandedKey(created.id);
      try { window.localStorage.setItem(EXPANDED_STORAGE_KEY, created.id); } catch { /* noop */ }
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Sessions" width="min(360px, 92vw)">
      <label className={styles.searchBox}>
        <Search size={13} aria-hidden="true" />
        <input placeholder="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {activeSession && (
        <>
          <div className={styles.sectionLabel}>Current session</div>
          <div className={styles.currentRow}>
            <span className={styles.avatar}>{initials(activeSession.title)}</span>
            {editingTitle ? (
              <input
                className={styles.titleInput}
                value={titleDraft}
                autoFocus
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEditTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                onBlur={commitEditTitle}
              />
            ) : (
              <span className={styles.titleText}>{activeSession.title || "Untitled session"}</span>
            )}
            <button type="button" className={styles.iconBtn} onClick={startEditTitle} aria-label="Rename session">
              <Pencil size={13} />
            </button>
          </div>
        </>
      )}

      <div className={styles.sectionLabel}>Projects</div>

      {loading ? (
        <>
          <Skeleton height="46px" radius="8px" style={{ marginBottom: 8 }} />
          <Skeleton height="46px" radius="8px" style={{ marginBottom: 8 }} />
          <Skeleton height="46px" radius="8px" />
        </>
      ) : (
        <>
          <ProjectSection
            sectionKey={GENERAL_KEY}
            name="General"
            isGeneral
            count={generalSessions.length}
            sessions={generalSessions}
            expanded={expandedKey === GENERAL_KEY}
            onToggle={() => setExpanded(GENERAL_KEY)}
            onResume={onResume}
            onNewSession={onNewSession}
            onRequestDeleteSession={onRequestDeleteSession}
          />

          {projects.map((p, i) => (
            <ProjectSection
              key={p.id}
              sectionKey={p.id}
              name={p.name}
              color={p.color}
              count={sessionsByProject.get(p.id)?.length || 0}
              sessions={sessionsByProject.get(p.id) || []}
              expanded={expandedKey === p.id}
              onToggle={() => setExpanded(p.id)}
              canMoveUp={i > 0}
              canMoveDown={i < projects.length - 1}
              onMoveUp={() => moveProject(i, -1)}
              onMoveDown={() => moveProject(i, 1)}
              onResume={onResume}
              onNewSession={onNewSession}
              onRequestDeleteSession={onRequestDeleteSession}
              editingName={renamingProjectId === p.id}
              onStartRename={() => startRenameProject(p)}
              onCommitRename={commitRenameProject}
              onCancelRename={() => setRenamingProjectId(null)}
              renameDraft={projectRenameDraft}
              setRenameDraft={setProjectRenameDraft}
              onRequestDeleteProject={() => onRequestDeleteProject(p)}
            />
          ))}
        </>
      )}

      {!loading && (newProjectOpen ? (
        <div className={styles.newProjectForm}>
          <input
            className={styles.newProjectInput}
            placeholder="Project name…"
            value={newProjectName}
            autoFocus
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitNewProject(); if (e.key === "Escape") setNewProjectOpen(false); }}
          />
          <div className={styles.colorRow}>
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={[styles.colorSwatch, newProjectColor === c ? styles.colorSwatchActive : ""].join(" ")}
                style={{ background: c }}
                onClick={() => setNewProjectColor(c)}
                aria-label={`Use color ${c}`}
              >
                {newProjectColor === c && <Check size={12} color="#fff" />}
              </button>
            ))}
          </div>
          <div className={styles.formActions}>
            <Button variant="ghost" size="sm" onClick={() => setNewProjectOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitNewProject} disabled={!newProjectName.trim()}>Create</Button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.newProjectBtn} onClick={() => setNewProjectOpen(true)}>
          <Plus size={14} aria-hidden="true" /> New project
        </button>
      ))}
    </Drawer>
  );
}
