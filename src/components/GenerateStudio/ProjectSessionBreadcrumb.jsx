import React, { useState, useRef, useEffect } from 'react';
import { Layers, Sparkles, ChevronDown, Plus, Check, Folder } from 'lucide-react';
import useSessionStore from '../../stores/SessionStore';

const PROJECT_COLORS = [
  '#7C5CFC', '#FF4D2E', '#1C7A5A', '#C77F12',
  '#2563EB', '#9333EA', '#0891B2', '#059669',
];

function initials(name = '') {
  return name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
}

export default function ProjectSessionBreadcrumb() {
  const {
    projects, activeProject, projectsLoading,
    fetchProjects, createProject, setActiveProject,
    sessions, activeSession, loadSession,
    createNewSession, fetchSessions,
  } = useSessionStore();

  const [projOpen, setProjOpen] = useState(false);
  const [sessOpen, setSessOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const projRef = useRef(null);
  const sessRef = useRef(null);

  useEffect(() => {
    fetchProjects();
    fetchSessions();
  }, []);

  useEffect(() => {
    const close = (e) => {
      if (projRef.current && !projRef.current.contains(e.target)) setProjOpen(false);
      if (sessRef.current && !sessRef.current.contains(e.target)) setSessOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const projectSessions = activeProject
    ? sessions.filter((s) => s.project_id === activeProject.id)
    : sessions;

  async function handleSelectProject(proj) {
    setActiveProject(proj);
    setProjOpen(false);
  }

  async function handleSelectSession(sess) {
    await loadSession(sess.id);
    setSessOpen(false);
  }

  async function handleCreateProject() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await createProject(
        newName.trim(),
        PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
      );
      setNewName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleNewSession() {
    await createNewSession('New session');
    setSessOpen(false);
  }

  const projLabel = activeProject?.name ?? 'All sessions';
  const sessLabel = activeSession?.title ?? 'New session';

  return (
    <div className="psb">

      {/* ── Project picker ───────────────────────────────────────── */}
      <div className="psb-pick" ref={projRef}>
        <button
          type="button"
          className="psb-btn"
          onClick={() => { setProjOpen((o) => !o); setSessOpen(false); }}
          aria-label="Switch project"
        >
          <Layers size={13} />
          <span className="psb-btn-label">{projLabel}</span>
          <ChevronDown size={13} className={`psb-chevron ${projOpen ? 'psb-chevron--open' : ''}`} />
        </button>

        {projOpen && (
          <div className="psb-drop">
            <div className="psb-drop-header">Projects</div>

            <button
              type="button"
              className={`psb-item ${!activeProject ? 'psb-item--active' : ''}`}
              onClick={() => handleSelectProject(null)}
            >
              <span className="psb-av psb-av--all"><Folder size={13} /></span>
              <span className="psb-copy">
                <b>All sessions</b>
                <small>{sessions.length} total</small>
              </span>
              {!activeProject && <Check size={13} className="psb-chk" />}
            </button>

            {projects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                className={`psb-item ${activeProject?.id === proj.id ? 'psb-item--active' : ''}`}
                onClick={() => handleSelectProject(proj)}
              >
                <span className="psb-av" style={{ background: proj.color }}>{initials(proj.name)}</span>
                <span className="psb-copy">
                  <b>{proj.name}</b>
                  <small>{sessions.filter((s) => s.project_id === proj.id).length} sessions</small>
                </span>
                {activeProject?.id === proj.id && <Check size={13} className="psb-chk" />}
              </button>
            ))}

            {projectsLoading && <div className="psb-loading">Loading…</div>}

            <div className="psb-divider" />

            <div className="psb-new-row">
              <input
                className="psb-new-input"
                placeholder="New project name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
              <button
                type="button"
                className="psb-new-submit"
                onClick={handleCreateProject}
                disabled={!newName.trim() || creating}
                aria-label="Create project"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <span className="psb-sep" aria-hidden="true">/</span>

      {/* ── Session picker ───────────────────────────────────────── */}
      <div className="psb-pick" ref={sessRef}>
        <button
          type="button"
          className="psb-btn"
          onClick={() => { setSessOpen((o) => !o); setProjOpen(false); }}
          aria-label="Switch session"
        >
          <Sparkles size={13} />
          <span className="psb-btn-label">{sessLabel}</span>
          <ChevronDown size={13} className={`psb-chevron ${sessOpen ? 'psb-chevron--open' : ''}`} />
        </button>

        {sessOpen && (
          <div className="psb-drop">
            <div className="psb-drop-header">
              {activeProject ? `${activeProject.name} sessions` : 'Recent sessions'}
            </div>

            {projectSessions.length === 0 && (
              <div className="psb-empty">No sessions yet</div>
            )}

            {projectSessions.slice(0, 10).map((sess) => (
              <button
                key={sess.id}
                type="button"
                className={`psb-item ${activeSession?.id === sess.id ? 'psb-item--active' : ''}`}
                onClick={() => handleSelectSession(sess)}
              >
                <span
                  className="psb-av"
                  style={{ background: activeProject?.color ?? 'var(--bgs-primary)' }}
                >
                  {initials(sess.title || 'S')}
                </span>
                <span className="psb-copy">
                  <b>{sess.title || 'Untitled session'}</b>
                  <small>{new Date(sess.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                </span>
                {activeSession?.id === sess.id && <Check size={13} className="psb-chk" />}
              </button>
            ))}

            <div className="psb-divider" />

            <button type="button" className="psb-new-session-btn" onClick={handleNewSession}>
              <Plus size={13} />
              New session{activeProject ? ` in ${activeProject.name}` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
