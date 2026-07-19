"use client";

// src/pages/HelpPage/HelpPage.jsx
// ui-v2 rebuild of Help & Support (see docs mockup "Help.dc.html"). All data
// logic (FAQ search, complaint/ticket submission, timeline, HelpStore) is
// untouched — only the shell and presentation moved to ui-v2. Adds a real
// keyboard-shortcuts reference: every shortcut listed below is grep-verified
// against actual key handlers in this codebase (Calendar's command bar,
// move-mode escape, Studio's lightbox nav, ui-v2 Modal/Dropdown escape-to-
// close) rather than the mockup's placeholder set.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, LifeBuoy, Search, Send, Keyboard } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import useHelpStore from "../../stores/HelpStore";
import { FAQ_SECTIONS } from "./helpContent";
import {
  COMPLAINT_CATEGORY,
  COMPLAINT_CATEGORY_LABEL,
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_DESCRIPTION,
  COMPLAINT_STATUS_LABEL,
} from "../../constants/statuses";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton,
  Card, Badge, Skeleton, EmptyState, Button, MobileNavDrawer,
  NotificationBell, AvatarMenu,
} from "../../ui-v2";
import styles from "./HelpPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "analytics", label: "Analytics", href: "/app/analytics" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], macKeys: ["⌘", "K"], description: "Open the command bar (Calendar)" },
  { keys: ["Esc"], description: "Close the open dialog or drawer, or exit move mode (Calendar)" },
  { keys: ["←", "→"], description: "Previous / next image in the lightbox (Studio)" },
];

function formatDateTime(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getResolvedByLabel(complaint) {
  return complaint?.resolvedBy?.full_name || complaint?.resolvedBy?.email || "Support Team";
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
  return fromLabel ? `${fromLabel} -> ${toLabel}` : toLabel;
}

const DEFAULT_FORM = {
  category: COMPLAINT_CATEGORY.OTHER,
  title: "",
  description: "",
  screenshotFile: null,
};

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

function HelpBody() {
  const { navigate, pathname, search } = useAppNavigation();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const credits = useCreditBalance(userId);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);

  const [faqQuery, setFaqQuery] = useState("");
  const [openItems, setOpenItems] = useState({});
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [formState, setFormState] = useState(DEFAULT_FORM);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const requestedTab = searchParams.get("tab") === "tickets" ? "my-tickets" : (searchParams.get("tab") === "shortcuts" ? "shortcuts" : "help-center");
  const requestedFormOpen = searchParams.get("form") === "open";

  const setPageSearchParams = (nextParams, options = { replace: true }) => {
    const query = nextParams.toString();
    navigate(`${pathname}${query ? `?${query}` : ""}`, options);
  };

  useEffect(() => {
    if (activeTab !== requestedTab) setActiveTab(requestedTab);
    if (formOpen !== requestedFormOpen) setFormOpen(requestedFormOpen);
  }, [activeTab, formOpen, requestedTab, requestedFormOpen, setActiveTab, setFormOpen]);

  useEffect(() => { fetchUserComplaints().catch(() => {}); }, [fetchUserComplaints]);

  useEffect(() => {
    if (activeTab !== "my-tickets") return undefined;
    const unreadResolvedIds = complaints
      .filter((c) => [COMPLAINT_STATUS.RESOLVED, COMPLAINT_STATUS.CLOSED].includes(c.status) && !c.user_notified_at)
      .map((c) => c.id);
    if (unreadResolvedIds.length) markComplaintsViewed(unreadResolvedIds).catch(() => {});
    return undefined;
  }, [activeTab, complaints, markComplaintsViewed]);

  useEffect(() => {
    if (!submitSuccess) return undefined;
    setFormState(DEFAULT_FORM);
    return undefined;
  }, [submitSuccess]);

  const normalizedFaqQuery = faqQuery.trim().toLowerCase();
  const filteredSections = useMemo(() => FAQ_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!normalizedFaqQuery) return true;
        return `${section.title} ${item.q} ${item.a}`.toLowerCase().includes(normalizedFaqQuery);
      }),
    }))
    .filter((section) => section.items.length > 0), [normalizedFaqQuery]);

  const handleTabChange = (tab) => {
    clearSubmitState();
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "my-tickets") { nextParams.set("tab", "tickets"); }
    else if (tab === "shortcuts") { nextParams.set("tab", "shortcuts"); nextParams.delete("form"); }
    else { nextParams.delete("tab"); nextParams.delete("form"); }
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

  const creditPct = credits.lifetimePurchased > 0
    ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100)))
    : 100;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey=""
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={(
          <>
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <NotificationBell userId={userId} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        )}
      />

      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={NAV_ITEMS} activeKey="" onNavClick={(item) => navigate(item.href)} />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.title}>Help &amp; Support</div>
              <div className={styles.sub}>Find answers quickly, then track support tickets in one place.</div>
            </div>
            <Button variant="ghost" onClick={() => navigate("/app/dashboard")}>Back to dashboard</Button>
          </div>

          <div className={styles.tabBar}>
            <button type="button" className={[styles.tabBtn, activeTab === "help-center" ? styles.tabBtnActive : ""].join(" ")} onClick={() => handleTabChange("help-center")}>
              <CircleHelp size={14} aria-hidden="true" /> Help Center
            </button>
            <button type="button" className={[styles.tabBtn, activeTab === "my-tickets" ? styles.tabBtnActive : ""].join(" ")} onClick={() => handleTabChange("my-tickets")}>
              <LifeBuoy size={14} aria-hidden="true" /> My Support Tickets
            </button>
            <button type="button" className={[styles.tabBtn, activeTab === "shortcuts" ? styles.tabBtnActive : ""].join(" ")} onClick={() => handleTabChange("shortcuts")}>
              <Keyboard size={14} aria-hidden="true" /> Keyboard shortcuts
            </button>
          </div>

          {activeTab === "help-center" ? (
            <div className={styles.stack}>
              <label className={styles.searchBar}>
                <Search size={16} aria-hidden="true" />
                <input type="search" value={faqQuery} onChange={(e) => setFaqQuery(e.target.value)} placeholder="Search help topics" />
              </label>

              {filteredSections.length ? (
                filteredSections.map((section) => (
                  <Card key={section.id}>
                    <div className={styles.faqSectionTitle}>{section.title}</div>
                    {section.items.map((item) => {
                      const itemKey = `${section.id}-${item.q}`;
                      const isOpen = Boolean(openItems[itemKey]);
                      return (
                        <div key={itemKey} className={styles.faqItem}>
                          <button
                            type="button"
                            className={styles.faqQuestion}
                            onClick={() => setOpenItems((c) => ({ ...c, [itemKey]: !c[itemKey] }))}
                          >
                            <span>{item.q}</span>
                            <ChevronDown size={16} className={isOpen ? styles.chevOpen : ""} aria-hidden="true" />
                          </button>
                          {isOpen ? <div className={styles.faqAnswer}>{item.a}</div> : null}
                        </div>
                      );
                    })}
                  </Card>
                ))
              ) : (
                <Card><EmptyState dashed title="No help articles found" description="Try a different search term or submit a support ticket." /></Card>
              )}

              <Card>
                <div className={styles.ctaRow}>
                  <p className={styles.ctaText}>Still need help with generation, scheduling, publishing, or account issues?</p>
                  <Button onClick={handleOpenForm}>Submit a support ticket</Button>
                </div>
              </Card>
            </div>
          ) : activeTab === "shortcuts" ? (
            <Card>
              <div className={styles.faqSectionTitle}>Keyboard shortcuts</div>
              <div className={styles.sectionSub}>Every shortcut below works today, scoped to where it's noted — this isn't a wishlist.</div>
              <div className={styles.shortcutList}>
                {SHORTCUTS.map((s, i) => (
                  <div key={i} className={styles.shortcutRow}>
                    <div className={styles.shortcutKeys}>
                      {(s.macKeys || s.keys).map((k, ki) => <kbd key={ki} className={styles.kbd}>{k}</kbd>)}
                    </div>
                    <div className={styles.shortcutDesc}>{s.description}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <div className={styles.stack}>
              <Card>
                <div className={styles.ticketToolbar}>
                  <div>
                    <div className={styles.faqSectionTitle}>My tickets</div>
                    <div className={styles.sectionSub}>Submit a new issue or review responses from the support team.</div>
                  </div>
                  <Button onClick={handleOpenForm}>Submit a new issue</Button>
                </div>
              </Card>

              {formOpen ? (
                <Card>
                  <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.formGrid}>
                      <label className={styles.field}>
                        <span>Category</span>
                        <select value={formState.category} onChange={(e) => setFormState((c) => ({ ...c, category: e.target.value }))}>
                          {Object.entries(COMPLAINT_CATEGORY_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>

                      <label className={[styles.field, styles.fieldSpan].join(" ")}>
                        <span>Title</span>
                        <input type="text" value={formState.title} maxLength={100} placeholder="Short description of the issue" onChange={(e) => setFormState((c) => ({ ...c, title: e.target.value }))} />
                      </label>

                      <label className={[styles.field, styles.fieldSpan].join(" ")}>
                        <span>Description</span>
                        <textarea rows="6" value={formState.description} minLength={20} maxLength={1000} placeholder="Tell us what happened, what you expected, and any steps to reproduce it." onChange={(e) => setFormState((c) => ({ ...c, description: e.target.value }))} />
                      </label>

                      <label className={[styles.field, styles.fieldSpan].join(" ")}>
                        <span>Screenshot</span>
                        <input type="file" accept="image/*" onChange={(e) => setFormState((c) => ({ ...c, screenshotFile: e.target.files?.[0] || null }))} />
                        <small className={styles.smallHint}>Optional. Image files only, up to 5MB.</small>
                      </label>
                    </div>

                    {submitError ? <div className={styles.formError}>{submitError}</div> : null}
                    {submitSuccess ? <div className={styles.formSuccess}>Your report has been submitted. We&apos;ll get back to you soon.</div> : null}

                    <div className={styles.formActions}>
                      <Button variant="ghost" type="button" onClick={handleCloseForm} disabled={submitting}>Cancel</Button>
                      <Button type="submit" disabled={submitting}>
                        <Send size={14} aria-hidden="true" /> {submitting ? "Submitting…" : "Submit report"}
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}

              {loadingComplaints ? (
                <Card><EmptyState dashed title="Loading tickets" description="Fetching your support ticket history." /></Card>
              ) : complaints.length ? (
                complaints.map((complaint) => {
                  const isExpanded = expandedTicketId === complaint.id;
                  return (
                    <Card key={complaint.id}>
                      <button type="button" className={styles.complaintHead} onClick={() => setExpandedTicketId((c) => (c === complaint.id ? null : complaint.id))}>
                        <div>
                          <div className={styles.complaintMeta}>
                            <Badge tone="neutral">{COMPLAINT_CATEGORY_LABEL[complaint.category] || "Other"}</Badge>
                            <Badge tone={complaint.status === COMPLAINT_STATUS.RESOLVED ? "success" : complaint.status === COMPLAINT_STATUS.CLOSED ? "neutral" : "info"}>
                              {COMPLAINT_STATUS_LABEL[complaint.status] || complaint.status}
                            </Badge>
                          </div>
                          <div className={styles.complaintTitle}>{complaint.title || complaint.subject || "Untitled issue"}</div>
                        </div>
                        <span className={styles.complaintDate}>{formatDateTime(complaint.created_at)}</span>
                      </button>

                      {isExpanded ? (
                        <div className={styles.complaintExpanded}>
                          <p>{complaint.description || "No description provided."}</p>

                          {complaint.status === COMPLAINT_STATUS.RESOLVED && complaint.resolution_note ? (
                            <div className={styles.resolutionNote}>
                              <strong>Resolution</strong>
                              <p>{complaint.resolution_note}</p>
                              <span>Resolved by {getResolvedByLabel(complaint)} on {formatDateTime(complaint.resolved_at)}</span>
                            </div>
                          ) : null}

                          {complaint.status === COMPLAINT_STATUS.CLOSED ? (
                            <div className={styles.resolutionNote}>
                              <strong>Closed</strong>
                              <p>{complaint.resolution_note || COMPLAINT_STATUS_DESCRIPTION.closed}</p>
                            </div>
                          ) : null}

                          {Array.isArray(complaint.timeline) && complaint.timeline.length > 0 ? (
                            <div className={styles.timeline}>
                              <strong>Timeline</strong>
                              {complaint.timeline.map((entry) => (
                                <div key={entry.id} className={styles.timelineItem}>
                                  <div className={styles.timelineHead}>
                                    <span>{entry.type === "status" ? getStatusTransitionLabel(entry) : "Support comment"}</span>
                                    <small>{formatDateTime(entry.created_at)}</small>
                                  </div>
                                  {entry.type === "status" && entry.note ? <p>{entry.note}</p> : null}
                                  {entry.type === "comment" ? <p>{entry.body || "No comment text."}</p> : null}
                                  <small>{getTimelineAuthor(entry)}</small>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  );
                })
              ) : (
                <Card><EmptyState dashed title="No support tickets yet" description="You have not submitted any support tickets yet." /></Card>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default function HelpPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <HelpBody />
    </UiV2ThemeProvider>
  );
}
