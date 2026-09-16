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
  AppShell, IconButton, Button, EmptyState, Skeleton, Modal,
} from "../../ui-v2";
import { useAuth } from "../../Context/AuthContext";
import usePersistentState from "../../hooks/usePersistentState";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import useLibraryStore from "../../stores/LibraryStore";
import { buildScheduleHandoffPath, toQuickPostAssetShape } from "../../services/assetLibraryService";
import {
  getItemTitle,
  getSourceLabel,
  getMetaLeftLabel,
  getMetaRightLabel,
  getFormatLabel,
  isClip,
  isUnused,
  formatDate,
} from "./libraryItemUtils";
import AssetCard from "./components/AssetCard";
import PublishReceipt from "./components/PublishReceipt";
import { derivePublishability } from "./publishability";
import useConnectedPlatforms from "./useConnectedPlatforms";
import QuickPostComposer from "../../calendar/components/QuickPostComposer";
import { createQuickPost } from "../../calendar/services/calendarService";
import { quickPostConfirmation } from "../../calendar/quickPostConfirmation";
import { DEFAULT_TIMEZONE } from "../../utils/timezone";
import { fetchUserSettings } from "../../services/userSettingsService";
import BulkActionBar from "./components/BulkActionBar";
import UploadModal from "./components/UploadModal";
import AssetDetailDrawer from "./components/AssetDetailDrawer";
import DeleteConfirmModal from "./components/DeleteConfirmModal";
import TrashView from "./components/TrashView";
import styles from "./LibraryPage.module.css";

const LIBRARY_FILTER_PREFS_KEY = "socialai:library-filter-prefs-v2";

const SOURCE_RAIL_ITEMS = [
  { value: "all", label: "All" },
  { value: "upload", label: "Uploads" },
  { value: "clip", label: "Clips" },
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

  // null while unknown — see publishability.js. "We could not check" and "you
  // have none" are different statements and must not render the same.
  const connectedPlatforms = useConnectedPlatforms();

  const [cachedPrefs] = useState(readStoredLibraryFilterPrefs);
  const [rememberFilters, setRememberFilters] = useState(Boolean(cachedPrefs?.remember));
  const [search, setSearch] = useState(cachedPrefs?.remember ? (cachedPrefs?.search || "") : "");
  const [sourceFilter, setSourceFilter] = useState(cachedPrefs?.remember ? (cachedPrefs?.sourceFilter || "all") : "all");
  const [statusRail, setStatusRail] = useState(null); // null | 'unused' | 'archived'
  // These three reset on every visit before, unlike search/sourceFilter above
  // which had their own opt-in "remember" toggle. They are view preferences
  // rather than a transient query, so they persist automatically (per user,
  // per device) — the existing remember-toggle behavior above is untouched.
  const [typeFilter, setTypeFilter] = usePersistentState("library.typeFilter", "all", { userId: user?.id ?? null, enabled: Boolean(user?.id) });
  const [tagFilter, setTagFilter] = usePersistentState("library.tagFilter", "all", { userId: user?.id ?? null, enabled: Boolean(user?.id) });
  const [unusedChipActive, setUnusedChipActive] = useState(false);
  const [viewMode, setViewMode] = usePersistentState("library.viewMode", "grid", { userId: user?.id ?? null, enabled: Boolean(user?.id) });
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  // The asset the publish composer is open over, already in the composer's
  // prop shape. Null = closed.
  const [composerAsset, setComposerAsset] = useState(null);
  // { postIds, assetTitle } once a send is queued. Null = no receipt open.
  const [receipt, setReceipt] = useState(null);

  // The composer renders times in the account timezone and says so in its own
  // banner, so an unresolved timezone would have it confidently label a time in
  // the wrong zone. Defaults to DEFAULT_TIMEZONE until settings load, exactly as
  // CalendarPage does — one answer to "what time is it for this user".
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  useEffect(() => {
    if (!user?.id) return undefined;
    let mounted = true;
    fetchUserSettings(user.id)
      .then((settings) => { if (mounted) setTimezone(settings.timezone || DEFAULT_TIMEZONE); })
      .catch((err) => {
        // Non-fatal: the banner falls back to the default and still names the
        // zone it is using, so the user is never shown an unlabelled time.
        console.error("[LibraryPage] could not load timezone:", err?.message || err);
      });
    return () => { mounted = false; };
  }, [user?.id]);

  // The composer's asset picker, so a user who opened it on the wrong asset can
  // switch without closing. The opened asset goes first and is deduped, so it
  // stays visible even when the current filters would exclude it — arriving from
  // a card and not finding that asset in the picker would be its own bug.
  const composerLibraryAssets = useMemo(() => {
    const shaped = (assets || []).map(toQuickPostAssetShape).filter(Boolean);
    if (!composerAsset) return shaped;
    return [composerAsset, ...shaped.filter((a) => a.id !== composerAsset.id)];
  }, [assets, composerAsset]);
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
      // A clip is stored as source='upload' (same pipeline, same checks) and
      // carries its provenance in metadata.origin. So "Clips" and "Uploads" are
      // two halves of one stored value, not two stored values.
      .filter((asset) => {
        if (sourceFilter === "all") return true;
        if (sourceFilter === "clip") return isClip(asset);
        if (sourceFilter === "upload") return asset.source === "upload" && !isClip(asset);
        return asset.source === sourceFilter;
      })
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

  // Clips and uploads share one stored source value, so their counts are split
  // here rather than server-side: fetchPersonalAssetCounts groups by `source`
  // and would report every clip as an upload. The store already holds the full
  // asset list, so this costs one pass and keeps a single counting rule instead
  // of two that could disagree.
  const railCounts = useMemo(() => {
    const active = assets.filter((a) => a.status === "active");
    const clipCount = active.filter(isClip).length;
    return {
      all: counts.all,
      upload: Math.max(0, (counts.upload ?? 0) - clipCount),
      clip: clipCount,
      generation: counts.generation,
      post: counts.post,
      unused: counts.unused,
      archived: counts.archived,
    };
  }, [counts, assets]);

  // Schedule still hands off to the Calendar, where the date picker lives.
  // Phase 3 unifies the two pickers; until then, moving this would mean building
  // a second one here.
  const handleSchedule = (asset) => {
    navigate(buildScheduleHandoffPath(asset.id));
  };

  // ── Publish: open the composer over the Library ──────────────────────────
  //
  // The composer is MOUNTED here rather than navigated to. The whole point of
  // the Library→publish join is that the user does not lose their place in the
  // grid to send one asset; bouncing to the Calendar and back is the flow this
  // replaces (LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md §1, join 1).
  //
  // Nothing about publishability is re-derived here. The card already computed
  // it via derivePublishability(), which decided whether this handler was
  // reachable at all; a second opinion on the same question is how two surfaces
  // start disagreeing about whether an asset can be sent.
  const handlePublish = (asset) => {
    setComposerAsset(toQuickPostAssetShape(asset));
  };

  const handleComposerSubmit = async (payload) => {
    if (!user?.id) {
      toast.error("Sign in again to publish — your session could not be read.");
      return false;
    }
    try {
      const created = await createQuickPost({ workspaceType: "personal", userId: user.id }, {
        mode: payload.mode,
        platforms: payload.platforms,
        captions: payload.captions,
        asset: payload.asset,
        scheduledAtISO: payload.scheduledAtISO,
        platformOptions: payload.platformOptions || {},
        titles: payload.titles || {},
        aiDisclosure: payload.aiDisclosure !== false,
        copyReview: payload.copyReview || {},
      });

      // ── A send ends in a receipt, never in a toast ──────────────────────
      //
      // A toast cannot report per destination, and a multi-destination send
      // half-succeeds for real — one row per platform, each dispatched
      // independently, so LinkedIn can publish while YouTube fails on media.
      // Before this, those two outcomes looked identical and the user was left
      // on the grid with a green message. The receipt polls the rows the
      // publisher actually writes and reports each one as it settles.
      //
      // A DRAFT keeps the toast, correctly: nothing was sent, so there is no
      // outcome to follow.
      if (payload.mode !== "draft" && Array.isArray(created) && created.length > 0) {
        setReceipt({
          postIds: created.map((row) => row.id).filter(Boolean),
          assetTitle: payload.asset?.name || "",
        });
        return true;
      }

      // Same copy the Calendar uses, from the same module — so neither surface
      // can drift into claiming the post is published when all that is known is
      // that it is queued. See quickPostConfirmation.js.
      const confirmation = quickPostConfirmation(payload.mode);
      toast.success(`${confirmation.title} — ${confirmation.desc}`);
      return true;
    } catch (err) {
      console.error("[LibraryPage] publish submit failed:", err);
      toast.error(err?.message
        ? `${err.message} — nothing was saved. Your captions are still in the form.`
        : "Nothing was saved. Your captions are still in the form.");
      return false;
    }
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

  const mainContent = (
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
                  <EmptyState
                    dashed
                    title="No assets found"
                    description="You have assets, but none match the current filters."
                    actions={<Button size="sm" variant="subtle" onClick={resetFilters}>Clear filters</Button>}
                  />
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
                          publishability={derivePublishability(asset, connectedPlatforms)}
                          onSchedule={handleSchedule}
                          onPublish={handlePublish}
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
                        {filteredAssets.map((asset) => {
                          const publishability = derivePublishability(asset, connectedPlatforms);
                          return (
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
                                {/* Same two actions as the grid card, and gated
                                    by the same derivation — a row and a card
                                    showing different answers for one asset is
                                    the drift this avoids. */}
                                <Button
                                  size="sm"
                                  disabled={!publishability.canOpenComposer}
                                  title={publishability.reason || undefined}
                                  onClick={() => handlePublish(asset)}
                                >
                                  Publish
                                </Button>
                                <IconButton title="Schedule" onClick={() => handleSchedule(asset)}>
                                  <Calendar size={14} aria-hidden="true" />
                                </IconButton>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
  );

  const overlays = (
    <>
      <Toaster position="top-center" />

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

      {/* The Calendar's composer, mounted over the Library — not a Library copy
          of it. Two composers means one of them rots
          (LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md §6), and the one that rots is
          always the one fewer people open.

          primaryAction="publish" is the only difference from the Calendar's
          mount: this surface leads with "Publish now" because the user arrived
          holding a finished asset, while the Calendar leads with "Schedule"
          because the user arrived holding a date. Both write the same row. */}
      {composerAsset && (
        <QuickPostComposer
          open
          timezone={timezone}
          primaryAction="publish"
          libraryAssets={composerLibraryAssets}
          prefillAsset={composerAsset}
          onClose={() => setComposerAsset(null)}
          onSubmit={handleComposerSubmit}
        />
      )}

      {/* The outcome of a send, per destination, polled from the rows the
          publisher writes. Opened by handleComposerSubmit for every non-draft
          send — see check-publish-receipt.cjs, which fails if a publish path
          can return to the grid without one. */}
      {receipt && (
        <PublishReceipt
          open
          postIds={receipt.postIds}
          assetTitle={receipt.assetTitle}
          onClose={() => { setReceipt(null); fetchLibraryData(); }}
          onOpenCalendar={() => { setReceipt(null); navigate("/app/calendar"); }}
        />
      )}

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
        // Copy review destinations: only those a connected account can actually
        // send THIS file to — from the same derivation the card uses.
        reviewPlatforms={drawerAsset
          ? derivePublishability(drawerAsset, connectedPlatforms).fits
            .filter((fit) => fit.accepts)
            .map((fit) => ({ key: fit.key, label: fit.label }))
          : []}
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

  return (
    <AppShell
      activeKey="library"
      className={styles.shell}
      mainClassName={styles.main}
      overlays={overlays}
    >
      {mainContent}
    </AppShell>
  );
}

export default function LibraryPage() {
  return <LibraryBody />;
}
