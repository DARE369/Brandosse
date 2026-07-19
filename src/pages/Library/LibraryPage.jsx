"use client";

// src/pages/Library/LibraryPage.jsx
// ui-v2 rebuild of the Personal Content Library screen (AS_IS_AUDIT.md +
// docs/calendar-library-rebuild/ui-v2-migration/library-mockup.html,
// APPROVED). Ports the working, QA-passed page shell that used to live in
// src/pages/LibraryPage/LibraryPageV2.jsx — same LibraryStore, same
// assetLibraryService, same every real handler/behavior. Only the
// presentation changed: legacy `Ui*` primitives + `--dash-*` tokens swapped
// for `src/ui-v2` primitives + `--uiv2-*` tokens, following the exact
// pattern already established by Studio (StudioPage.jsx) and Dashboard
// (PersonalDashboardPage.jsx).
import { useEffect, useMemo, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  Calendar, FileImage, Filter, Grid3X3, List, RefreshCw, Search, Upload, X,
} from "lucide-react";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, MobileNavDrawer, CreditPill,
  IconButton, Button, EmptyState, Skeleton, NotificationBell, AvatarMenu, Modal,
} from "../../ui-v2";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import useLibraryStore from "../../stores/LibraryStore";
import { buildScheduleHandoffPath } from "../../services/assetLibraryService";
import {
  getItemTitle,
  getSourceLabel,
  getMetaLeftLabel,
  getMetaRightLabel,
  getFormatLabel,
  isUnused,
  formatDate,
} from "./libraryItemUtils";
import AssetCard from "./components/AssetCard";
import BulkActionBar from "./components/BulkActionBar";
import UploadModal from "./components/UploadModal";
import AssetDetailDrawer from "./components/AssetDetailDrawer";
import DeleteConfirmModal from "./components/DeleteConfirmModal";
import TrashView from "./components/TrashView";
import styles from "./LibraryPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

const LIBRARY_FILTER_PREFS_KEY = "socialai:library-filter-prefs-v2";

const SOURCE_RAIL_ITEMS = [
  { value: "all", label: "All" },
  { value: "upload", label: "Uploads" },
  { value: "generation", label: "Generations" },
  { value: "post", label: "Post-linked" },
];
const STATUS_RAIL_ITEMS = [
  { value: "unused", label: "Unused" },
  { value: "archived", label: "Archived" },
];

function readStoredLibraryFilterPrefs() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return JSON.parse(window.localStorage.getItem(LIBRARY_FILTER_PREFS_KEY) || "null");
  } catch (_err) {
    return null;
  }
}

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

function LibraryTableThumb({ asset }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.thumbWrap}>
      {asset.thumbnail_url && !failed ? (
        <img src={asset.thumbnail_url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <FileImage size={16} />
      )}
    </span>
  );
}

function SkeletonGrid() {
  return (
    <div className={styles.assetGrid}>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <Skeleton height="0" style={{ aspectRatio: "1 / 1", borderRadius: 0 }} />
          <div className={styles.skeletonCardBody}>
            <Skeleton height="12px" width="70%" radius="4px" />
            <Skeleton height="9px" width="40%" radius="4px" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LibraryBody() {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const credits = useCreditBalance(user?.id ?? null);

  const {
    assets,
    counts,
    loading,
    error,
    fetchLibraryData,
    uploadAsset,
    updateAssetMetadata,
    archiveAsset,
    unarchiveAsset,
    duplicateAsset,
    softDeleteAsset,
    fetchAssetById,
    fetchUsedIn,
    fetchVersionChainFor,
    markAsNewVersion,
    fetchTrash,
    restoreAsset,
    clearError,
  } = useLibraryStore();

  const [cachedPrefs] = useState(readStoredLibraryFilterPrefs);
  const [rememberFilters, setRememberFilters] = useState(Boolean(cachedPrefs?.remember));
  const [search, setSearch] = useState(cachedPrefs?.remember ? (cachedPrefs?.search || "") : "");
  const [sourceFilter, setSourceFilter] = useState(cachedPrefs?.remember ? (cachedPrefs?.sourceFilter || "all") : "all");
  const [statusRail, setStatusRail] = useState(null); // null | 'unused' | 'archived'
  const [typeFilter, setTypeFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [unusedChipActive, setUnusedChipActive] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [drawerAsset, setDrawerAsset] = useState(null);
  const [drawerUsedIn, setDrawerUsedIn] = useState([]);
  const [versionChain, setVersionChain] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Trash is a full content-area page state per the approved mockup
  // (data-panel="trash"), not a modal — see TrashView.jsx header comment.
  const [showTrash, setShowTrash] = useState(false);
  const [trashedAssets, setTrashedAssets] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    fetchLibraryData();
  }, [fetchLibraryData]);

  useEffect(() => {
    const handler = () => fetchLibraryData({ force: true });
    window.addEventListener("socialai:data-sync", handler);
    return () => window.removeEventListener("socialai:data-sync", handler);
  }, [fetchLibraryData]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (!rememberFilters) {
      window.localStorage.removeItem(LIBRARY_FILTER_PREFS_KEY);
      return;
    }
    window.localStorage.setItem(LIBRARY_FILTER_PREFS_KEY, JSON.stringify({
      remember: true,
      search,
      sourceFilter,
    }));
  }, [rememberFilters, search, sourceFilter]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const availableTags = useMemo(() => {
    const tagSet = new Set();
    assets.forEach((asset) => {
      (asset.tags || []).forEach((tag) => tag && tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return assets
      .filter((asset) => {
        if (statusRail === "archived") return asset.status === "archived";
        if (asset.status !== "active") return false;
        if (statusRail === "unused") return isUnused(asset);
        return true;
      })
      .filter((asset) => (sourceFilter === "all" ? true : asset.source === sourceFilter))
      .filter((asset) => (typeFilter === "all" ? true : asset.media_type === typeFilter))
      .filter((asset) => (tagFilter === "all" ? true : (asset.tags || []).includes(tagFilter)))
      .filter((asset) => (unusedChipActive ? isUnused(asset) : true))
      .filter((asset) => {
        if (!query) return true;
        return (
          (asset.title || "").toLowerCase().includes(query)
          || (asset.description || "").toLowerCase().includes(query)
          || (asset.alt_text || "").toLowerCase().includes(query)
          || (asset.tags || []).join(" ").toLowerCase().includes(query)
          || (asset.ai_tags || []).join(" ").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [assets, search, sourceFilter, statusRail, typeFilter, tagFilter, unusedChipActive]);

  const railCounts = useMemo(() => ({
    all: counts.all,
    upload: counts.upload,
    generation: counts.generation,
    post: counts.post,
    unused: counts.unused,
    archived: counts.archived,
  }), [counts]);

  const handleSchedule = (asset) => {
    navigate(buildScheduleHandoffPath(asset.id));
  };

  const openDrawer = async (asset) => {
    setDrawerAsset(asset);
    setDrawerUsedIn([]);
    setVersionChain([]);
    try {
      const [usedIn, chain] = await Promise.all([
        fetchUsedIn(asset.id),
        fetchVersionChainFor(asset.id),
      ]);
      setDrawerUsedIn(usedIn);
      setVersionChain(chain);
    } catch (err) {
      console.error("Failed to load asset detail:", err);
    }
  };

  const handleSaveMetadata = async (assetId, updates) => {
    try {
      const updated = await updateAssetMetadata(assetId, updates);
      setDrawerAsset(updated);
      toast.success("Changes saved");
    } catch (err) {
      console.error("Save metadata failed:", err);
      toast.error("Could not save changes");
    }
  };

  const handleUploadOne = async ({ file, onProgress }) => uploadAsset({
    file,
    title: file.name,
    onProgress,
  });

  const handleMarkAsVersion = async ({ oldAssetId, newAssetId }) => {
    try {
      await markAsNewVersion({ oldAssetId, newAssetId });
      toast.success("Linked as a new version");
    } catch (err) {
      toast.error(err?.message || "Could not link this as a new version — the previous upload was not updated.");
      throw err;
    }
  };

  const handleArchive = async (asset) => {
    const wasArchived = asset.status === "archived";
    try {
      if (wasArchived) await unarchiveAsset(asset.id);
      else await archiveAsset(asset.id);
      toast.success(wasArchived ? "Unarchived" : "Archived");
    } catch (err) {
      console.error("Archive toggle failed:", err);
      toast.error(wasArchived ? "Failed to unarchive" : "Failed to archive");
    }
  };

  const handleDuplicate = async (asset) => {
    try {
      await duplicateAsset(asset.id);
      toast.success("Duplicated");
    } catch (err) {
      console.error("Duplicate failed:", err);
      toast.error(err?.message || "Failed to duplicate");
    }
  };

  const confirmDelete = async (asset) => {
    setDeleteBusy(true);
    try {
      await softDeleteAsset(asset.id);
      toast.success("Moved to Trash — recoverable for 30 days");
      setDeleteTarget(null);
      if (drawerAsset?.id === asset.id) setDrawerAsset(null);
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error("Failed to delete");
    } finally {
      setDeleteBusy(false);
    }
  };

  const openTrash = async () => {
    setShowTrash(true);
    setTrashLoading(true);
    try {
      const rows = await fetchTrash();
      setTrashedAssets(rows);
    } catch (err) {
      console.error("Failed to load Trash:", err);
      toast.error("Could not load Trash");
    } finally {
      setTrashLoading(false);
    }
  };

  const closeTrash = () => setShowTrash(false);

  const handleRestore = async (asset) => {
    try {
      await restoreAsset(asset.id);
      setTrashedAssets((current) => current.filter((row) => row.id !== asset.id));
      toast.success(`Restored "${getItemTitle(asset)}"`);
      fetchLibraryData({ force: true });
    } catch (err) {
      console.error("Restore failed:", err);
      toast.error(err?.message || "Could not restore this asset");
    }
  };

  const handleNavigateToPost = (post) => {
    navigate(`/app/calendar?postId=${encodeURIComponent(post.id)}`);
  };

  const handleOpenVersion = async (version) => {
    const full = await fetchAssetById(version.id);
    if (full) openDrawer(full);
  };

  const resetFilters = () => {
    setSearch("");
    setSourceFilter("all");
    setStatusRail(null);
    setTypeFilter("all");
    setTagFilter("all");
    setUnusedChipActive(false);
  };

  // ── Bulk select ────────────────────────────────────────────────────────
  const toggleItemSelected = (asset) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const toggleBulkMode = () => {
    setBulkMode((current) => {
      if (current) clearSelection();
      return !current;
    });
  };
  const selectedAssets = filteredAssets.filter((asset) => selectedIds.has(asset.id));

  const runBulkAction = async (actionFn, successMessage) => {
    if (selectedAssets.length === 0) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(selectedAssets.map((asset) => actionFn(asset)));
    setBulkBusy(false);
    const failures = results.filter((r) => r.status === "rejected").length;
    if (failures > 0) toast.error(`${failures} of ${selectedAssets.length} failed`);
    else toast.success(successMessage);
    clearSelection();
  };

  const handleBulkArchive = () => runBulkAction((asset) => archiveAsset(asset.id), "Assets archived");
  const confirmBulkDelete = async () => {
    setBulkDeleteConfirmOpen(false);
    await runBulkAction((asset) => softDeleteAsset(asset.id), "Assets moved to Trash");
  };

  const activeStatusLabel = statusRail
    ? STATUS_RAIL_ITEMS.find((i) => i.value === statusRail)?.label
    : SOURCE_RAIL_ITEMS.find((i) => i.value === sourceFilter)?.label;
  const activeRailCount = statusRail ? railCounts[statusRail] : railCounts[sourceFilter];

  const railContent = (onSelect) => (
    <>
      <p className={styles.railLabel}>Source</p>
      {SOURCE_RAIL_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={[styles.railItem, (!statusRail && sourceFilter === item.value) ? styles.railItemActive : ""].filter(Boolean).join(" ")}
          onClick={() => { setSourceFilter(item.value); setStatusRail(null); onSelect?.(); }}
        >
          <span>{item.label}</span>
          <span className={styles.railItemCount}>{railCounts[item.value]}</span>
        </button>
      ))}
      <p className={styles.railLabel}>Status</p>
      {STATUS_RAIL_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={[styles.railItem, statusRail === item.value ? styles.railItemActive : ""].filter(Boolean).join(" ")}
          onClick={() => { setStatusRail(item.value); onSelect?.(); }}
        >
          <span>{item.label}</span>
          <span className={styles.railItemCount}>{railCounts[item.value]}</span>
        </button>
      ))}
      <button
        type="button"
        className={styles.railItem}
        style={{ marginTop: 6 }}
        onClick={() => { onSelect?.(); openTrash(); }}
      >
        <span>Trash</span>
      </button>
    </>
  );

  const isEmptyLibrary = !loading && assets.length === 0;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();
  const creditPct = credits.lifetimePurchased > 0 ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100))) : 100;

  return (
    <>
      <Toaster position="top-center" />

      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="library"
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
            <NotificationBell userId={user?.id} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        )}
      />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey="library"
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={styles.main}>
        <div className={styles.canvas}>
          {showTrash ? (
            <>
              <div className={styles.pageHeadRow}>
                <div>
                  <div className={styles.pageTitle}>Trash</div>
                  <div className={styles.pageDesc}>Deleted assets, recoverable for 30 days.</div>
                </div>
                <div className={styles.pageActions}>
                  <Button variant="subtle" onClick={closeTrash}>Back to Library</Button>
                </div>
              </div>
              <TrashView trashedAssets={trashedAssets} loading={trashLoading} onRestore={handleRestore} />
            </>
          ) : (
            <>
              <div className={styles.pageHeadRow}>
                <div>
                  <div className={styles.pageTitle}>Library</div>
                  <div className={styles.pageDesc}>Every upload, generation, and post-linked asset in one place.</div>
                </div>
                <div className={styles.pageActions}>
                  <Button variant="subtle" onClick={toggleBulkMode}>
                    {bulkMode ? "Done selecting" : "Select"}
                  </Button>
                  <Button variant="subtle" onClick={() => fetchLibraryData({ force: true })} title="Refresh library">
                    <RefreshCw size={14} aria-hidden="true" />
                    Refresh
                  </Button>
                  <Button onClick={() => setShowUploadModal(true)}>
                    <Upload size={14} aria-hidden="true" />
                    Upload
                  </Button>
                  <div className={styles.viewToggle}>
                    <IconButton
                      title="Grid view"
                      className={viewMode === "grid" ? styles.viewToggleBtnActive : ""}
                      onClick={() => setViewMode("grid")}
                    >
                      <Grid3X3 size={14} />
                    </IconButton>
                    <IconButton
                      title="Table view"
                      className={viewMode === "list" ? styles.viewToggleBtnActive : ""}
                      onClick={() => setViewMode("list")}
                    >
                      <List size={14} />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div className={styles.filterRow}>
                <button type="button" className={styles.mobileRailToggle} onClick={() => setMobileRailOpen(true)} aria-haspopup="dialog">
                  <Filter size={14} aria-hidden="true" />
                  <span>{activeStatusLabel} <span className={styles.mobileRailToggleCount}>{activeRailCount}</span></span>
                </button>

                <label className={styles.searchBox}>
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search title, description, tags…"
                  />
                </label>

                <select className={styles.selectChip} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by type">
                  <option value="all">All types</option>
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="document">Document</option>
                </select>

                <button
                  type="button"
                  className={[styles.filterChip, unusedChipActive ? styles.filterChipActive : ""].filter(Boolean).join(" ")}
                  onClick={() => setUnusedChipActive((v) => !v)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" strokeLinecap="round" /></svg>
                  Unused only
                </button>

                {availableTags.length > 0 ? (
                  <select className={styles.selectChip} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="Filter by tag">
                    <option value="all">All tags</option>
                    {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                  </select>
                ) : null}

                <label className={styles.rememberCheck}>
                  <input type="checkbox" checked={rememberFilters} onChange={(event) => setRememberFilters(event.target.checked)} />
                  Keep filters
                </label>

                <Button variant="ghost" size="sm" onClick={resetFilters}>Reset filters</Button>
              </div>

              <div className={styles.layoutGrid}>
                <aside className={styles.leftRail}>{railContent()}</aside>

                <section>
                  {loading ? (
                    <SkeletonGrid />
                  ) : isEmptyLibrary ? (
                    <EmptyState
                      title="Nothing in your Library yet"
                      description="Upload your first asset — logos, brand photography, anything you'll want to post later."
                      actions={(
                        <>
                          <Button onClick={() => setShowUploadModal(true)}>Upload your first asset</Button>
                          <Button variant="ghost" onClick={() => navigate("/app/generate")}>or generate something in AI Studio</Button>
                        </>
                      )}
                    />
                  ) : filteredAssets.length === 0 ? (
                    <EmptyState dashed title="No assets found" description="Try changing filters or upload new content." />
                  ) : viewMode === "grid" ? (
                    <>
                      <div className={styles.assetGrid}>
                        {filteredAssets.map((asset) => (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            selectable={bulkMode}
                            isSelected={selectedIds.has(asset.id)}
                            onToggleSelect={toggleItemSelected}
                            onOpenDrawer={openDrawer}
                            onSchedule={handleSchedule}
                            onArchive={handleArchive}
                            onDelete={(a) => setDeleteTarget(a)}
                          />
                        ))}
                      </div>
                      <BulkActionBar
                        count={selectedAssets.length}
                        busy={bulkBusy}
                        onArchive={handleBulkArchive}
                        onDelete={() => setBulkDeleteConfirmOpen(true)}
                        onClear={clearSelection}
                      />
                    </>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.checkboxCell}><input type="checkbox" aria-label="Select all" /></th>
                            <th>Name</th>
                            <th>Source</th>
                            <th>Type</th>
                            <th>Size</th>
                            <th>Used in</th>
                            <th>Added</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAssets.map((asset) => (
                            <tr key={asset.id}>
                              <td className={styles.checkboxCell}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(asset.id)}
                                  onChange={() => toggleItemSelected(asset)}
                                  aria-label={`Select ${getItemTitle(asset)}`}
                                />
                              </td>
                              <td>
                                <div className={styles.nameCell}>
                                  <LibraryTableThumb asset={asset} />
                                  <span>
                                    <span className={styles.nameCellTitle}>{getItemTitle(asset)}</span>
                                    <span className={styles.nameCellSub}>{(asset.tags || []).join(", ") || (asset.ai_tags || []).join(", ")}</span>
                                  </span>
                                </div>
                              </td>
                              <td>{getSourceLabel(asset)}</td>
                              <td>{getFormatLabel(asset)}</td>
                              <td>{getMetaLeftLabel(asset).split("·")[1]?.trim() || ""}</td>
                              <td className={styles.tableSecondary}>{getMetaRightLabel(asset)}</td>
                              <td className={styles.tableSecondary}>{formatDate(asset.created_at)}</td>
                              <td>
                                <div className={styles.tableActions}>
                                  <Button variant="subtle" size="sm" onClick={() => openDrawer(asset)}>View</Button>
                                  <IconButton title="Schedule" onClick={() => handleSchedule(asset)}>
                                    <Calendar size={14} aria-hidden="true" />
                                  </IconButton>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Mobile filter bottom sheet */}
      <div
        className={[styles.bottomSheetBackdrop, mobileRailOpen ? styles.bottomSheetBackdropOpen : ""].filter(Boolean).join(" ")}
        onClick={() => setMobileRailOpen(false)}
      />
      <div className={[styles.bottomSheetPanel, mobileRailOpen ? styles.bottomSheetPanelOpen : ""].filter(Boolean).join(" ")} role="dialog" aria-label="Filter Library">
        <div className={styles.bottomSheetHandle} />
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>Filter Library</span>
          <button type="button" className={styles.sheetCloseBtn} onClick={() => setMobileRailOpen(false)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {railContent(() => setMobileRailOpen(false))}
      </div>

      <UploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadOne={handleUploadOne}
        onMarkAsVersion={handleMarkAsVersion}
      />

      <AssetDetailDrawer
        asset={drawerAsset}
        open={Boolean(drawerAsset)}
        onClose={() => setDrawerAsset(null)}
        onSaveMetadata={handleSaveMetadata}
        onSchedule={handleSchedule}
        onDelete={(asset) => setDeleteTarget(asset)}
        onDuplicate={handleDuplicate}
        onArchive={handleArchive}
        usedInPosts={drawerUsedIn}
        versionChain={versionChain}
        onOpenVersion={handleOpenVersion}
        onNavigateToPost={handleNavigateToPost}
      />

      <DeleteConfirmModal
        asset={deleteTarget}
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        busy={deleteBusy}
      />

      <Modal
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        size="sm"
        title={`Delete ${selectedAssets.length} assets?`}
        description="They move to Trash and can be restored for 30 days."
        actions={(
          <>
            <Button variant="subtle" onClick={() => setBulkDeleteConfirmOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button variant="dangerSolid" onClick={confirmBulkDelete} disabled={bulkBusy}>
              {bulkBusy ? "Moving…" : "Move to Trash"}
            </Button>
          </>
        )}
      />
    </>
  );
}

export default function LibraryPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <LibraryBody />
    </UiV2ThemeProvider>
  );
}
