import React, { useMemo, useState } from "react";
import { ArrowRight, CircleHelp, FileText, Search, Ticket, X } from "lucide-react";
import useHelpStore from "../../stores/HelpStore";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { FAQ_SECTIONS } from "../../pages/HelpPage/helpContent";
import { COMPLAINT_CATEGORY_LABEL, COMPLAINT_STATUS_LABEL } from "../../constants/statuses";
function formatShortDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function HelpPanel({ open, onClose }) {
  const { navigate } = useAppNavigation();
  const [search, setSearch] = useState("");
  const complaints = useHelpStore((state) => state.complaints);
  const loadingComplaints = useHelpStore((state) => state.loadingComplaints);

  const normalizedSearch = search.trim().toLowerCase();
  const condensedSections = useMemo(() => {
    return FAQ_SECTIONS
      .map((section) => {
        const items = section.items
          .filter((item) => {
            if (!normalizedSearch) return true;
            const haystack = `${section.title} ${item.q} ${item.a}`.toLowerCase();
            return haystack.includes(normalizedSearch);
          })
          .slice(0, 3);

        return {
          ...section,
          items,
        };
      })
      .filter((section) => section.items.length > 0);
  }, [normalizedSearch]);

  const recentTickets = complaints.slice(0, 3);

  const handleNavigate = (path) => {
    onClose?.();
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        className={`help-panel-overlay ${open ? "open" : "closed"}`}
        aria-label="Close help panel"
        onClick={onClose}
      />

      <aside className={`help-panel ${open ? "open" : "closed"}`} aria-hidden={!open}>
        <div className="help-panel-header">
          <div>
            <span className="help-panel-eyebrow">Support</span>
            <h2>Help & Support</h2>
          </div>
          <button type="button" className="help-panel-close" onClick={onClose} aria-label="Close help panel">
            <X size={18} />
          </button>
        </div>

        <div className="help-panel-body">
          <label className="help-panel-search">
            <Search size={15} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search help articles"
            />
          </label>

          <div className="help-panel-faq-condensed">
            {condensedSections.length ? (
              condensedSections.map((section) => (
                <section key={section.id} className="help-panel-section">
                  <div className="help-panel-section-title">
                    <CircleHelp size={14} />
                    <span>{section.title}</span>
                  </div>
                  {section.items.map((item) => (
                    <article key={item.q} className="help-panel-faq-item">
                      <strong>{item.q}</strong>
                      <p>{item.a}</p>
                    </article>
                  ))}
                </section>
              ))
            ) : (
              <div className="help-panel-empty">No articles matched your search.</div>
            )}
          </div>

          <button
            type="button"
            className="help-panel-link"
            onClick={() => handleNavigate("/app/help")}
          >
            <FileText size={14} />
            View all help articles
            <ArrowRight size={14} />
          </button>

          <div className="help-panel-divider" />

          <div className="help-panel-tickets-summary">
            <div className="help-panel-section-title">
              <Ticket size={14} />
              <span>Recent tickets</span>
            </div>

            {loadingComplaints ? (
              <div className="help-panel-empty">Loading tickets...</div>
            ) : recentTickets.length ? (
              recentTickets.map((ticket) => (
                <article key={ticket.id} className="help-panel-ticket-item">
                  <div className="help-panel-ticket-top">
                    <span className="help-panel-ticket-category">
                      {COMPLAINT_CATEGORY_LABEL[ticket.category] || "Support"}
                    </span>
                    <span className={`help-panel-ticket-status ${ticket.status}`}>
                      {COMPLAINT_STATUS_LABEL[ticket.status] || ticket.status}
                    </span>
                  </div>
                  <strong>{ticket.title || ticket.subject || "Untitled issue"}</strong>
                  <span>{formatShortDate(ticket.created_at)}</span>
                </article>
              ))
            ) : (
              <div className="help-panel-empty">You have not submitted any tickets yet.</div>
            )}
          </div>
        </div>

        <div className="help-panel-footer">
          <button
            type="button"
            className="help-panel-primary"
            onClick={() => handleNavigate("/app/help?tab=tickets&form=open")}
          >
            Submit new issue
          </button>
          <button
            type="button"
            className="help-panel-secondary"
            onClick={() => handleNavigate("/app/help?tab=tickets")}
          >
            View all tickets
          </button>
        </div>
      </aside>
    </>
  );
}
