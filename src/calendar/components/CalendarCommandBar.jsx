// Cmd+K AI command bar for the calendar.
// Opens as a modal overlay; user types a natural language command.
// Displays suggested commands when empty, then shows AI result + action buttons.
import { useState, useEffect, useRef, useCallback } from 'react';
import { Calendar, Clock, Sparkles, RefreshCw, Image as ImageIcon, BarChart3, Star, X, Plus } from 'lucide-react';
import { executeCalendarCommand } from '../../services/calendarAIService';

const SUGGESTED_COMMANDS = [
  { Icon: Calendar,  text: 'Generate a week plan for 3 posts', category: 'Planning' },
  { Icon: Clock,     text: 'Suggest the best times to post this week', category: 'Planning' },
  { Icon: Sparkles,  text: 'Audit my caption for the selected post',  category: 'Content' },
  { Icon: RefreshCw, text: 'Reschedule failed posts to next available slot', category: 'Scheduling' },
  { Icon: ImageIcon, text: 'Which draft should I post first?',          category: 'Content' },
  { Icon: BarChart3, text: 'How many posts do I have scheduled this week?', category: 'Insights' },
];

// ── Keyboard navigation hook ──────────────────────────────────────────────────
function useArrowNav(items, onSelect) {
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        onSelect(items[activeIdx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, activeIdx, onSelect]);

  return { activeIdx, setActiveIdx };
}

// ── Action button builder ─────────────────────────────────────────────────────
function ActionButtons({ actions, onApply }) {
  if (!actions?.length) return null;

  return (
    <div className="cal3-cmdbar__result-actions">
      {actions.map((action, i) => {
        const meta = ACTION_LABEL[action.type] || { Icon: null, label: action.type };
        return (
          <button
            key={i}
            className="cal3-btn-ai"
            style={{ fontSize: 12, height: 30, padding: '0 12px' }}
            onClick={() => onApply?.(action)}
          >
            {meta.Icon ? <meta.Icon size={12} aria-hidden="true" /> : null}
            {meta.label}
          </button>
        );
      })}
      <button
        className="cal3-btn-ghost"
        style={{ fontSize: 12, height: 30 }}
        onClick={() => onApply?.(null)}
      >
        Dismiss
      </button>
    </div>
  );
}

const ACTION_LABEL = {
  reschedule:     { Icon: RefreshCw, label: 'Apply reschedule' },
  update_caption: { Icon: Sparkles,  label: 'Apply caption fix' },
  add_draft_post: { Icon: Plus,      label: 'Schedule draft' },
  delete_post:    { Icon: X,         label: 'Delete post' },
  suggest_slots:  { Icon: Star,      label: 'Show optimal slots' },
  week_plan:      { Icon: Sparkles,  label: 'Apply week plan' },
  audit:          { Icon: Sparkles,  label: 'Open in panel' },
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function CalendarCommandBar({ context, preset = '', onClose, onApplyAction }) {
  const [query,   setQuery]   = useState(preset || '');
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const inputRef = useRef(null);

  // Sync preset when it changes (e.g., opened from palette with pre-filled text)
  useEffect(() => {
    if (preset) setQuery(preset);
  }, [preset]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSuggestionSelect = useCallback((suggestion) => {
    setQuery(typeof suggestion === 'string' ? suggestion : suggestion.text);
    inputRef.current?.focus();
  }, []);

  const { activeIdx, setActiveIdx } = useArrowNav(
    query ? [] : SUGGESTED_COMMANDS,
    handleSuggestionSelect,
  );

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const data = await executeCalendarCommand(trimmed, {
        weekStart:      context?.weekStart,
        posts:          context?.posts     || [],
        drafts:         context?.drafts    || [],
        selectedPostId: context?.selectedPostId || null,
      });
      // Ensure certain intents always have an apply action button
      const enriched = { ...data };
      if (enriched.intent === 'week_plan' && Array.isArray(enriched.plan) && enriched.plan.length > 0) {
        if (!enriched.actions?.some((a) => a.type === 'week_plan')) {
          enriched.actions = [{ type: 'week_plan', payload: {} }, ...(enriched.actions || [])];
        }
      }
      if (enriched.intent === 'suggest_slots') {
        if (!enriched.actions?.some((a) => a.type === 'suggest_slots')) {
          enriched.actions = [{ type: 'suggest_slots', payload: {} }, ...(enriched.actions || [])];
        }
      }
      setResult(enriched);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [query, loading, context]);

  const handleApplyAction = useCallback((action) => {
    // Pass the full result so parent can access result.plan, result.suggestions, etc.
    onApplyAction?.(action, result);
    if (!action) {
      setResult(null);
      setQuery('');
    }
    // Don't auto-close — let the parent decide (it calls onClose after applying)
  }, [onApplyAction, result]);

  const showSuggestions = !query && !result && !loading;
  const showResult      = Boolean(result) && !loading;

  return (
    <div
      className="cal3-cmdbar-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-label="AI calendar command"
    >
      <div className="cal3-cmdbar">

        {/* Input row */}
        <form onSubmit={handleSubmit}>
          <div className="cal3-cmdbar__input-row">
            <div className="cal3-cmdbar__ai-icon"><Sparkles size={16} aria-hidden="true" /></div>
            <input
              ref={inputRef}
              className="cal3-cmdbar__input"
              type="text"
              placeholder="Ask AI anything about your calendar…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setResult(null);
                setError(null);
                setActiveIdx(-1);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            {loading && <div className="cal3-cmdbar__spinner" />}
            {query && !loading && (
              <button
                type="submit"
                className="cal3-btn-ai"
                style={{ fontSize: 12, height: 28, padding: '0 10px' }}
              >
                Run
              </button>
            )}
          </div>
        </form>

        {/* Suggestions list */}
        {showSuggestions && (
          <div className="cal3-cmdbar__suggestions">
            {Object.entries(
              SUGGESTED_COMMANDS.reduce((acc, cmd, i) => {
                (acc[cmd.category] = acc[cmd.category] || []).push({ ...cmd, i });
                return acc;
              }, {}),
            ).map(([category, cmds]) => (
              <div key={category} className="cal3-cmdbar__suggestion-group">
                <div className="cal3-cmdbar__suggestion-label">{category}</div>
                {cmds.map((cmd) => (
                  <button
                    key={cmd.text}
                    className={`cal3-cmdbar__suggestion-item ${activeIdx === cmd.i ? 'cal3-cmdbar__suggestion-item--active' : ''}`}
                    onClick={() => handleSuggestionSelect(cmd)}
                    type="button"
                  >
                    <span className="cal3-cmdbar__suggestion-icon"><cmd.Icon size={14} aria-hidden="true" /></span>
                    <span className="cal3-cmdbar__suggestion-text">{cmd.text}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* AI result */}
        {showResult && (
          <div className="cal3-cmdbar__result">
            <div className="cal3-cmdbar__result-reply">{result.reply}</div>
            <ActionButtons actions={result.actions} onApply={handleApplyAction} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="cal3-cmdbar__error">
            {error}
            <button
              className="cal3-btn-ghost"
              style={{ marginLeft: 10, fontSize: 12, height: 26 }}
              onClick={() => { setError(null); setQuery(''); }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Footer hint */}
        <div className="cal3-cmdbar__footer">
          <div className="cal3-cmdbar__footer-hint">
            <kbd className="cal3-kbd" style={{ background: 'var(--surface-alt)', color: 'var(--color-text-tertiary)' }}>↑↓</kbd>
            <span>navigate</span>
          </div>
          <div className="cal3-cmdbar__footer-hint">
            <kbd className="cal3-kbd" style={{ background: 'var(--surface-alt)', color: 'var(--color-text-tertiary)' }}>↵</kbd>
            <span>run</span>
          </div>
          <div className="cal3-cmdbar__footer-hint">
            <kbd className="cal3-kbd" style={{ background: 'var(--surface-alt)', color: 'var(--color-text-tertiary)' }}>Esc</kbd>
            <span>close</span>
          </div>
        </div>

      </div>
    </div>
  );
}
