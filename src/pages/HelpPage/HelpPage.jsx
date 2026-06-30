"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, LifeBuoy, Search, Send } from "lucide-react";
import UserNavbar from "../../components/User/UserNavbar";
import UserSidebar from "../../components/User/UserSidebar";
import { UiButton, UiEmptyState, UiPageHeader, UiTabs } from "../../components/Shared/ui";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import useHelpStore from "../../stores/HelpStore";
import { FAQ_SECTIONS } from "./helpContent";
import {
  COMPLAINT_CATEGORY,
  COMPLAINT_CATEGORY_LABEL,
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_DESCRIPTION,
  COMPLAINT_STATUS_LABEL,
} from "../../constants/statuses";
function formatDateTime(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getResolvedByLabel(complaint) {
  const name = complaint?.resolvedBy?.full_name || complaint?.resolvedBy?.email;
  return name || "Support Team";
}

function getTimelineAuthor(entry) {
  const authorName = entry?.author?.full_name || entry?.author?.email;
  if (authorName) return authorName;
  if (entry?.author_type === "admin") return "Support Team";
  if (entry?.author_type === "user") return "You";
  return "System";
}

function getStatusTransitionLabel(entry) {
  const toLabel = COMPLAINT_STATUS_LABEL[entry?.to_status] || entry?.to_status || "Updated";
  const fromLabel = COMPLAINT_STATUS_LABEL[entry?.from_status] || entry?.from_status || "";
  if (fromLabel) {
    return `${fromLabel} -> ${toLabel}`;
  }
  return toLabel;
}

const DEFAULT_FORM = {
  category: COMPLAINT_CATEGORY.OTHER,
  title: "",
  description: "",
  screenshotFile: null,
};

export default function HelpPage() {
  const { navigate, pathname, search } = useAppNavigation();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const [faqQuery, setFaqQuery] = useState("");
  const [openItems, setOpenItems] = useState({});
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [formState, setFormState] = useState(DEFAULT_FORM);
  const complaints = useHelpStore((state) => state.complaints);
  const loadingComplaints = useHelpStore((state) => state.loadingComplaints);
  const submitting = useHelpStore((state) => state.submitting);
  const submitError = useHelpStore((state) => state.submitError);
  const submitSuccess = useHelpStore((state) => state.submitSuccess);
  const activeTab = useHelpStore((state) => state.activeTab);
  const formOpen = useHelpStore((state) => state.formOpen);
  const fetchUserComplaints = useHelpStore((state) => state.fetchUserComplaints);
  const submitComplaint = useHelpStore((state) => state.submitComplaint);
  const markComplaintsViewed = useHelpStore((state) => state.markComplaintsViewed);
  const setActiveTab = useHelpStore((state) => state.setActiveTab);
  const setFormOpen = useHelpStore((state) => state.setFormOpen);
  const clearSubmitState = useHelpStore((state) => state.clearSubmitState);
  const requestedTab = searchParams.get("tab") === "tickets" ? "my-tickets" : "help-center";
  const requestedFormOpen = searchParams.get("form") === "open";

  const setPageSearchParams = (nextParams, options = { replace: true }) => {
    const query = nextParams.toString();
    navigate(`${pathname}${query ? `?${query}` : ""}`, options);
  };

  useEffect(() => {
    if (activeTab !== requestedTab) {
      setActiveTab(requestedTab);
    }

    if (formOpen !== requestedFormOpen) {
      setFormOpen(requestedFormOpen);
    }
  }, [activeTab, formOpen, requestedFormOpen, requestedTab, setActiveTab, setFormOpen]);

  useEffect(() => {
    fetchUserComplaints().catch(() => {});
  }, [fetchUserComplaints]);

  useEffect(() => {
    if (activeTab !== "my-tickets") return undefined;

    const unreadResolvedIds = complaints
      .filter((complaint) => (
        [COMPLAINT_STATUS.RESOLVED, COMPLAINT_STATUS.CLOSED].includes(complaint.status)
        && !complaint.user_notified_at
      ))
      .map((complaint) => complaint.id);

    if (unreadResolvedIds.length) {
      markComplaintsViewed(unreadResolvedIds).catch(() => {});
    }

    return undefined;
  }, [activeTab, complaints, markComplaintsViewed]);

  useEffect(() => {
    if (!submitSuccess) return undefined;

    setFormState(DEFAULT_FORM);
    return undefined;
  }, [submitSuccess]);

  const normalizedFaqQuery = faqQuery.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    return FAQ_SECTIONS
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (!normalizedFaqQuery) return true;
          const haystack = `${section.title} ${item.q} ${item.a}`.toLowerCase();
          return haystack.includes(normalizedFaqQuery);
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [normalizedFaqQuery]);

  const handleTabChange = (tab) => {
    clearSubmitState();
    const nextParams = new URLSearchParams(searchParams);

    if (tab === "my-tickets") {
      nextParams.set("tab", "tickets");
    } else {
      nextParams.delete("tab");
      nextParams.delete("form");
    }

    setPageSearchParams(nextParams, { replace: true });
    setActiveTab(tab);
  };

  const handleOpenForm = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", "tickets");
    nextParams.set("form", "open");
    setPageSearchParams(nextParams, { replace: true });
    setActiveTab("my-tickets");
    setFormOpen(true);
    clearSubmitState();
  };

  const handleCloseForm = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("form");
    setPageSearchParams(nextParams, { replace: true });
    setFormOpen(false);
    setFormState(DEFAULT_FORM);
    clearSubmitState();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    await submitComplaint(formState);
  };

  return (
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />

      <main className="help-page-container">
        <UiPageHeader
          className="help-page-header"
          eyebrow="Support"
          title="Help & Support"
          description="Find answers quickly, then track support tickets in one place."
          actions={(
            <UiButton type="button" variant="secondary" className="help-page-back-link" onClick={() => navigate("/app/dashboard")}>
              Back to dashboard
            </UiButton>
          )}
        />

        <UiTabs
          className="help-tabs"
          tabs={[
            { value: "help-center", label: "Help Center", icon: CircleHelp },
            { value: "my-tickets", label: "My Support Tickets", icon: LifeBuoy },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          ariaLabel="Help tabs"
        />

        {activeTab === "help-center" ? (
          <section className="help-page-section">
            <label className="help-search-bar">
              <Search size={16} />
              <input
                type="search"
                value={faqQuery}
                onChange={(event) => setFaqQuery(event.target.value)}
                placeholder="Search help topics"
              />
            </label>

            {filteredSections.length ? (
              filteredSections.map((section) => (
                <div key={section.id} className="help-faq-section">
                  <h2 className="help-faq-section-title">{section.title}</h2>
                  {section.items.map((item) => {
                    const itemKey = `${section.id}-${item.q}`;
                    const isOpen = Boolean(openItems[itemKey]);

                    return (
                      <article key={itemKey} className={`help-faq-item ${isOpen ? "open" : ""}`}>
                        <button
                          type="button"
                          className="help-faq-question"
                          onClick={() => setOpenItems((current) => ({ ...current, [itemKey]: !current[itemKey] }))}
                        >
                          <span>{item.q}</span>
                          <ChevronDown size={16} />
                        </button>
                        {isOpen ? <div className="help-faq-answer">{item.a}</div> : null}
                      </article>
                    );
                  })}
                </div>
              ))
            ) : (
              <UiEmptyState
                className="help-empty-state"
                title="No help articles found"
                description="Try a different search term or submit a support ticket."
              />
            )}

            <div className="help-center-cta">
              <p>Still need help with generation, scheduling, publishing, or account issues?</p>
              <UiButton type="button" variant="primary" className="help-primary-button" onClick={handleOpenForm}>
                Submit a support ticket
              </UiButton>
            </div>
          </section>
        ) : (
          <section className="help-page-section">
            <div className="help-ticket-toolbar">
              <div>
                <h2>My tickets</h2>
                <p>Submit a new issue or review responses from the support team.</p>
              </div>
              <UiButton type="button" variant="primary" className="help-primary-button" onClick={handleOpenForm}>
                Submit a new issue
              </UiButton>
            </div>

            {formOpen ? (
              <form className="help-complaint-form" onSubmit={handleSubmit}>
                <div className="help-form-grid">
                  <label>
                    <span>Category</span>
                    <select
                      value={formState.category}
                      onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value }))}
                    >
                      {Object.entries(COMPLAINT_CATEGORY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="help-form-span">
                    <span>Title</span>
                    <input
                      type="text"
                      value={formState.title}
                      maxLength={100}
                      placeholder="Short description of the issue"
                      onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>

                  <label className="help-form-span">
                    <span>Description</span>
                    <textarea
                      rows="6"
                      value={formState.description}
                      minLength={20}
                      maxLength={1000}
                      placeholder="Tell us what happened, what you expected, and any steps to reproduce it."
                      onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                    />
                  </label>

                  <label className="help-form-span">
                    <span>Screenshot</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setFormState((current) => ({
                        ...current,
                        screenshotFile: event.target.files?.[0] || null,
                      }))}
                    />
                    <small>Optional. Image files only, up to 5MB.</small>
                  </label>
                </div>

                {submitError ? <div className="help-form-error">{submitError}</div> : null}
                {submitSuccess ? (
                  <div className="help-complaint-form-success">
                    Success: Your report has been submitted. We'll get back to you soon.
                  </div>
                ) : null}

                <div className="help-form-actions">
                  <UiButton type="submit" variant="primary" className="help-primary-button" loading={submitting}>
                    <Send size={15} />
                    {submitting ? "Submitting..." : "Submit Report"}
                  </UiButton>
                  <UiButton type="button" variant="secondary" className="help-secondary-button" onClick={handleCloseForm} disabled={submitting}>
                    Cancel
                  </UiButton>
                </div>
              </form>
            ) : null}

            <div className="complaint-list">
              {loadingComplaints ? (
                <UiEmptyState
                  className="help-empty-state"
                  title="Loading tickets"
                  description="Fetching your support ticket history."
                />
              ) : complaints.length ? (
                complaints.map((complaint) => {
                  const isExpanded = expandedTicketId === complaint.id;

                  return (
                    <article key={complaint.id} className="complaint-row">
                      <button
                        type="button"
                        className="complaint-row-header"
                        onClick={() => setExpandedTicketId((current) => current === complaint.id ? null : complaint.id)}
                      >
                        <div>
                          <div className="complaint-row-meta">
                            <span className="complaint-category-tag">
                              {COMPLAINT_CATEGORY_LABEL[complaint.category] || "Other"}
                            </span>
                            <span className={`complaint-status-badge ${complaint.status}`}>
                              {COMPLAINT_STATUS_LABEL[complaint.status] || complaint.status}
                            </span>
                          </div>
                          <strong>{complaint.title || complaint.subject || "Untitled issue"}</strong>
                        </div>
                        <span>{formatDateTime(complaint.created_at)}</span>
                      </button>

                      {isExpanded ? (
                        <div className="complaint-row-expanded">
                          <p>{complaint.description || "No description provided."}</p>

                          {complaint.status === COMPLAINT_STATUS.RESOLVED && complaint.resolution_note ? (
                            <div className="complaint-resolution-note">
                              <strong>Resolution</strong>
                              <p>{complaint.resolution_note}</p>
                              <span>
                                Resolved by {getResolvedByLabel(complaint)} on {formatDateTime(complaint.resolved_at)}
                              </span>
                            </div>
                          ) : null}

                          {complaint.status === COMPLAINT_STATUS.CLOSED ? (
                            <div className="complaint-resolution-note">
                              <strong>Closed</strong>
                              <p>{complaint.resolution_note || COMPLAINT_STATUS_DESCRIPTION.closed}</p>
                            </div>
                          ) : null}

                          {Array.isArray(complaint.timeline) && complaint.timeline.length > 0 ? (
                            <div className="complaint-timeline">
                              <strong>Timeline</strong>
                              <div className="complaint-timeline-list">
                                {complaint.timeline.map((entry) => (
                                  <article key={entry.id} className="complaint-timeline-item">
                                    <div className="complaint-timeline-head">
                                      <span>
                                        {entry.type === "status"
                                          ? getStatusTransitionLabel(entry)
                                          : "Support comment"}
                                      </span>
                                      <small>{formatDateTime(entry.created_at)}</small>
                                    </div>
                                    {entry.type === "status" && entry.note ? (
                                      <p>{entry.note}</p>
                                    ) : null}
                                    {entry.type === "comment" ? (
                                      <p>{entry.body || "No comment text."}</p>
                                    ) : null}
                                    <small>{getTimelineAuthor(entry)}</small>
                                  </article>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <UiEmptyState
                  className="help-empty-state"
                  title="No support tickets yet"
                  description="You have not submitted any support tickets yet."
                />
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
