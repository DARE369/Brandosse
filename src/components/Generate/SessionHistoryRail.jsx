// src/components/Generate/SessionHistoryRail.jsx
import React, { useEffect, useState } from 'react';
import { Plus, MessageSquare, Clock, Trash2, ChevronLeft, ChevronRight, X, History } from 'lucide-react';
import toast from 'react-hot-toast';
import useSessionStore from '../../stores/SessionStore';
import { useAppNavigation } from '../../Context/AppNavigationContext';
export default function SessionHistoryRail({
  isOpen,
  onClose,
  onOpen,
  onCreateSession = null,
  onSelectSession = null,
}) {
  const { navigate } = useAppNavigation();
  const {
    sessions,
    activeSession,
    fetchSessions,
    deleteSession,
  } = useSessionStore();

  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNewSession = () => {
    if (typeof onCreateSession === 'function') {
      onCreateSession();
      onClose?.();
      return;
    }

    navigate('/app/generate');
    onClose?.();
  };

  const handleSelect = (sessionId) => {
    if (!sessionId) return;

    if (typeof onSelectSession === 'function') {
      onSelectSession(sessionId);
      onClose?.();
      return;
    }

    navigate(`/app/generate/${sessionId}`);
    onClose?.();
  };

  const handleDeleteRequest = (event, sessionId) => {
    event.stopPropagation();
    setPendingDeleteId(sessionId);
  };

  const handleDeleteConfirm = async (event) => {
    event.stopPropagation();
    const sessionId = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await deleteSession(sessionId);
      toast.success('Session deleted');
    } catch {
      toast.error('Could not delete session');
    }
  };

  const handleDeleteCancel = (event) => {
    event.stopPropagation();
    setPendingDeleteId(null);
  };

  const handleSessionKeyDown = (event, sessionId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(sessionId);
    }
  };

  const formatRelative = (dateString) => {
    const date = new Date(dateString);
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {isOpen && (
        <div
          className="session-rail-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`session-history-rail ${isOpen ? '' : 'collapsed'}`}
        aria-label="Session navigation"
        aria-hidden={!isOpen}
      >
        <div className="history-panel-header">
          <div className="history-panel-header-left">
            <h2 className="history-panel-title">
              <History size={14} aria-hidden="true" />
              <span>Session History</span>
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Close history panel"
            className="history-panel-collapse"
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div className="history-panel-new-session">
          <button
            className="history-panel-new-btn"
            onClick={handleNewSession}
            type="button"
          >
            <Plus size={14} />
            New Session
          </button>
        </div>

        <nav className="sessions-list" aria-label="Sessions">
          {sessions.length === 0 ? (
            <div className="session-empty" role="note">
              <MessageSquare size={28} aria-hidden="true" />
              <p>No sessions yet</p>
              <span>Start generating to create one</span>
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = activeSession?.id === session.id;
              return (
                <div
                  key={session.id}
                  className={`session-item ${isActive ? 'active' : ''} ${pendingDeleteId === session.id ? 'pending-delete' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => pendingDeleteId !== session.id && handleSelect(session.id)}
                  onKeyDown={(event) => pendingDeleteId !== session.id && handleSessionKeyDown(event, session.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={session.title}
                >
                  {pendingDeleteId === session.id ? (
                    <div className="session-delete-confirm">
                      <span className="session-delete-confirm-text">Delete session?</span>
                      <div className="session-delete-confirm-actions">
                        <button
                          type="button"
                          className="session-delete-confirm-btn cancel"
                          onClick={handleDeleteCancel}
                          aria-label="Cancel delete"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="session-delete-confirm-btn confirm"
                          onClick={handleDeleteConfirm}
                          aria-label="Confirm delete"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="session-icon" aria-hidden="true">
                        <MessageSquare size={15} />
                      </div>

                      <div className="session-content">
                        <span className="session-title">{session.title || 'Untitled'}</span>
                        <span className="session-time">
                          <Clock size={10} aria-hidden="true" />
                          {formatRelative(session.updated_at || session.created_at)}
                        </span>
                      </div>

                      <button
                        className="session-delete-btn"
                        onClick={(event) => handleDeleteRequest(event, session.id)}
                        aria-label={`Delete session "${session.title}"`}
                        title="Delete session"
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </nav>
      </aside>

      <button
        className={`rail-toggle-tab ${isOpen ? 'rail-open' : 'rail-closed'}`}
        onClick={isOpen ? onClose : onOpen}
        aria-label={isOpen ? 'Close session history' : 'Open session history'}
        type="button"
      >
        {isOpen ? (
          <ChevronLeft size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
    </>
  );
}
