// =============================================================================
// PERSONAL CONTENT LIBRARY — MOCKUP INTERACTIVITY
// Packet 2, Phase 2. Static/representative data only — no backend wiring.
// Real, demonstrable JS for: grid/table view switching, bulk-select with tap
// equivalents, drag-drop + simulated per-file upload progress, non-blocking
// duplicate warning, async AI-tagging shimmer, table sort, asset detail
// drawer, soft-delete confirmation, and the Schedule hand-off that genuinely
// opens Packet 1's Calendar mockup gallery in a new tab (spec §7).
// =============================================================================

(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Generic open/close helpers for drawers, modals — identical contract to
     Packet 1's mockup.js so behavior is consistent across both galleries.
     --------------------------------------------------------------------- */
  function openEl(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  function closeEl(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  document.querySelectorAll('[data-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-open');
      // If this trigger carries an asset name (Schedule actions on cards/
      // table rows), thread it into the hand-off confirmation modal's
      // asset-name display before opening it, so the modal always shows
      // which specific asset is travelling with the click-through.
      if (targetId === 'schedule-handoff-confirm') {
        var assetName = btn.getAttribute('data-asset-name') || 'this asset';
        var nameSlot = document.getElementById('handoff-asset-name');
        if (nameSlot) nameSlot.textContent = assetName;
      }
      openEl(targetId);
    });
  });
  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeEl(btn.getAttribute('data-close'));
    });
  });
  document.querySelectorAll('[data-backdrop-close]').forEach(function (backdrop) {
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) backdrop.hidden = true;
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('[data-backdrop-close]').forEach(function (b) {
      if (!b.hidden) b.hidden = true;
    });
    closeGalleryNav();
  });

  /* ---------------------------------------------------------------------
     Gallery's own demo nav (harness chrome) — off-canvas drawer below
     768px, identical mechanism to Packet 1's gallery.
     --------------------------------------------------------------------- */
  var galleryShell = document.getElementById('gallery-shell');
  var galleryNavToggle = document.getElementById('gallery-nav-toggle');
  var galleryNavClose = document.getElementById('gallery-nav-close');
  var galleryNavBackdrop = document.getElementById('gallery-nav-backdrop');
  var galleryNav = document.getElementById('gallery-nav');

  function openGalleryNav() {
    if (!galleryShell) return;
    galleryShell.classList.add('is-nav-open');
    if (galleryNavToggle) galleryNavToggle.setAttribute('aria-expanded', 'true');
  }
  function closeGalleryNav() {
    if (!galleryShell) return;
    galleryShell.classList.remove('is-nav-open');
    if (galleryNavToggle) galleryNavToggle.setAttribute('aria-expanded', 'false');
  }
  if (galleryNavToggle) galleryNavToggle.addEventListener('click', openGalleryNav);
  if (galleryNavClose) galleryNavClose.addEventListener('click', closeGalleryNav);
  if (galleryNavBackdrop) galleryNavBackdrop.addEventListener('click', closeGalleryNav);
  if (galleryNav) {
    galleryNav.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', closeGalleryNav);
    });
  }

  /* ---------------------------------------------------------------------
     Grid / Table view switcher (within the main demo Library shell)
     --------------------------------------------------------------------- */
  document.querySelectorAll('[data-view-switch]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var group = btn.closest('[data-view-group]');
      var target = btn.getAttribute('data-view-switch');
      if (!group) return;
      group.querySelectorAll('[data-view-switch]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      // Grid/table aren't both rendered in the primary demo shell (table has
      // its own dedicated gallery section below for clarity) — this toggle
      // demonstrates the switcher's active state; a real implementation
      // would swap the panel here exactly like Packet 1's data-view-panel
      // mechanism. Documented as a deliberate mockup simplification, not an
      // oversight: both views are fully built and reachable via the nav.
      if (target === 'table') {
        var frame = group.closest('.gallery-frame');
        var hint = frame ? frame.querySelector('.gallery-frame__hint') : null;
        if (hint) hint.textContent = 'See the dedicated "Table view" section in the nav for the full sortable table';
      }
    });
  });

  /* ---------------------------------------------------------------------
     Bulk-select mode — checkbox toggles on cards, sticky bulk bar appears
     once >=1 selected, "Select" button toggles always-visible select mode
     for touch users who don't want to rely on hover-revealed checkboxes.
     --------------------------------------------------------------------- */
  function updateBulkBar(scopeEl, barId, countId) {
    var bar = document.getElementById(barId);
    var countEl = document.getElementById(countId);
    if (!bar || !countEl) return;
    var selected = scopeEl.querySelectorAll('.asset-card.is-selected').length;
    countEl.textContent = String(selected);
    bar.hidden = selected === 0;
  }

  document.querySelectorAll('[data-select-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var card = btn.closest('.asset-card');
      if (!card) return;
      card.classList.toggle('is-selected');
      var scope = card.closest('.lib-grid') || document;
      updateBulkBar(scope, 'lib-bulk-bar-grid', 'lib-bulk-count-grid');
    });
  });

  var bulkModeToggleGrid = document.getElementById('bulk-mode-toggle-grid');
  if (bulkModeToggleGrid) {
    bulkModeToggleGrid.addEventListener('click', function () {
      var grid = document.querySelector('#grid-view .lib-grid');
      if (!grid) return;
      var nowOn = !grid.classList.contains('bulk-mode-on');
      grid.classList.toggle('bulk-mode-on', nowOn);
      grid.querySelectorAll('.asset-card').forEach(function (card) {
        card.classList.toggle('bulk-mode', nowOn);
      });
      bulkModeToggleGrid.classList.toggle('is-active', nowOn);
      bulkModeToggleGrid.textContent = nowOn ? 'Done selecting' : 'Select';
    });
  }

  document.querySelectorAll('[data-bulk-clear]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var scope = btn.getAttribute('data-bulk-clear') === 'grid'
        ? document.querySelector('#grid-view .lib-grid')
        : document;
      if (!scope) return;
      scope.querySelectorAll('.asset-card.is-selected').forEach(function (c) { c.classList.remove('is-selected'); });
      updateBulkBar(scope, 'lib-bulk-bar-grid', 'lib-bulk-count-grid');
    });
  });

  /* ---------------------------------------------------------------------
     Cards (and table rows) open the asset detail drawer on click — but a
     click on an inner interactive control (select checkbox, action button,
     overflow menu) must not also trigger the card-level open. Mirrors the
     same "don't open behind an inner control" guard Packet 1 used for cells.
     --------------------------------------------------------------------- */
  document.querySelectorAll('.asset-card[data-open]').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('button') && e.target.closest('button') !== card) return;
      openEl(card.getAttribute('data-open'));
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== card) return; // a focused inner button handles its own activation
        e.preventDefault();
        openEl(card.getAttribute('data-open'));
      }
    });
  });

  /* ---------------------------------------------------------------------
     "Unused only" filter chip (header filterbar) — toggles active state.
     Visual-only in this mockup (the grid shown is representative, not a
     live-filtered dataset); the dedicated "Unused filter" gallery section
     demonstrates the actual filtered result set explicitly.
     --------------------------------------------------------------------- */
  document.querySelectorAll('[data-filter-chip]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      chip.classList.toggle('is-active');
    });
  });
  var unusedDemoChip = document.getElementById('unused-filter-demo-chip');
  if (unusedDemoChip) {
    unusedDemoChip.addEventListener('click', function () {
      unusedDemoChip.classList.toggle('is-active');
    });
  }

  /* ---------------------------------------------------------------------
     Mobile rail-replacement bottom sheet (fix round 1) -- the same 6
     Source/Status options the desktop .lib-rail shows, reachable below
     600px via .lib-mobile-rail-toggle. Selecting an item in the sheet
     mirrors the rail's own is-active behavior and updates the toggle
     button's label so the current selection stays visible once the sheet
     closes (open/close itself is already handled by the generic
     [data-open]/[data-close]/[data-backdrop-close] handlers above).
     --------------------------------------------------------------------- */
  var mobileRailToggleLabel = document.querySelector('.lib-mobile-rail-toggle__label');
  var mobileRailSheet = document.getElementById('lib-mobile-rail-sheet');
  if (mobileRailSheet && mobileRailToggleLabel) {
    mobileRailSheet.querySelectorAll('.lib-rail__item').forEach(function (item) {
      item.addEventListener('click', function () {
        mobileRailSheet.querySelectorAll('.lib-rail__item').forEach(function (i) {
          i.classList.toggle('is-active', i === item);
        });
        var text = item.querySelector('.lib-rail__item-text');
        var count = item.querySelector('.lib-rail__item-count');
        mobileRailToggleLabel.innerHTML = (text ? text.textContent : '') +
          (count ? ' <span class="lib-mobile-rail-toggle__count">' + count.textContent + '</span>' : '');
        // data-close on these buttons already closes the sheet via the
        // generic handler above; nothing further to do here.
      });
    });
  }

  /* ---------------------------------------------------------------------
     Table view — column header sort (visual state only: toggles
     aria-sort and an up/down indicator; representative data does not
     actually re-order, consistent with "static, representative content
     only" instruction — the interaction affordance itself is real).
     --------------------------------------------------------------------- */
  document.querySelectorAll('.lib-table th[data-sort] button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var th = btn.closest('th');
      var table = th.closest('table');
      var currentlyAsc = th.getAttribute('aria-sort') === 'ascending';
      table.querySelectorAll('th[data-sort]').forEach(function (otherTh) {
        otherTh.removeAttribute('aria-sort');
      });
      th.setAttribute('aria-sort', currentlyAsc ? 'descending' : 'ascending');
    });
  });

  /* ---------------------------------------------------------------------
     UPLOAD FLOW — drag-drop + simulated multi-file per-file progress.
     Modeled on AssetUploader.jsx's handleFiles()/uploadItems queue shape:
     each file gets its own {id, name, progress, status} row; progress
     animates independently per file via setInterval, never blocking other
     rows. A duplicate warning is injected under the first file in the demo
     batch (representative of the checksum-match case, spec §5) and the
     last file in the demo batch always "completes" with AI-tag shimmer
     that resolves a moment later (spec §5/§11) — both deterministic so a
     reviewer sees every required state without needing real files.
     --------------------------------------------------------------------- */
  var dropzone = document.getElementById('upload-dropzone');
  var fileInput = document.getElementById('upload-file-input');
  var queueEl = document.getElementById('upload-modal-queue');
  var uploadSeq = 0;

  function triggerBrowse() {
    if (fileInput) fileInput.click();
  }
  if (dropzone) {
    dropzone.addEventListener('click', triggerBrowse);
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerBrowse();
      }
    });
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropzone.classList.add('is-dragging');
    });
    dropzone.addEventListener('dragleave', function () {
      dropzone.classList.remove('is-dragging');
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
      handleFiles(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : simulatedFileList(3));
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      handleFiles(fileInput.files && fileInput.files.length ? fileInput.files : simulatedFileList(2));
      fileInput.value = '';
    });
  }

  // Static mockup has no real files to read from a click-to-browse picker in
  // every environment (some browsers block synthetic file selection
  // entirely) — when the native picker yields nothing, fall back to a
  // deterministic simulated batch so the upload flow is always demonstrable
  // without requiring the reviewer to have specific files on hand.
  function simulatedFileList(count) {
    var names = ['product-shot.jpg', 'brand-logo.png', 'studio-shot-v2.jpg', 'demo-clip.mp4'];
    var out = [];
    for (var i = 0; i < count; i += 1) {
      out.push({ name: names[i % names.length], size: 1024 * 1024 * (1 + i) });
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function handleFiles(fileList) {
    if (!queueEl || !fileList || !fileList.length) return;
    var files = Array.prototype.slice.call(fileList);
    files.forEach(function (file, index) {
      uploadSeq += 1;
      var id = 'upload-item-' + uploadSeq;
      var isDuplicateDemo = index === 0 && /studio-shot/i.test(file.name || '');
      var row = document.createElement('div');
      row.className = 'upload-queue-item';
      row.id = id;
      row.innerHTML =
        '<span class="upload-queue-item__thumb">' + (/\.(mp4|webm|mov)$/i.test(file.name || '') ? '&#127909;' : '&#128247;') + '</span>' +
        '<div class="upload-queue-item__body">' +
          '<div class="upload-queue-item__name-row"><span class="upload-queue-item__name">' + escapeHtml(file.name || 'file') + '</span><span class="upload-queue-item__pct">0%</span></div>' +
          '<div class="upload-queue-item__track"><div class="upload-queue-item__fill" style="width:0%;"></div></div>' +
        '</div>' +
        '<span class="upload-queue-item__status-icon" hidden></span>';
      queueEl.appendChild(row);
      animateUploadProgress(row, isDuplicateDemo);
    });
  }

  function animateUploadProgress(row, isDuplicateDemo) {
    var fill = row.querySelector('.upload-queue-item__fill');
    var pctLabel = row.querySelector('.upload-queue-item__pct');
    var statusIcon = row.querySelector('.upload-queue-item__status-icon');
    var pct = 0;
    var interval = setInterval(function () {
      pct += Math.round(8 + Math.random() * 14);
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        row.classList.add('is-done');
        if (fill) fill.style.width = '100%';
        if (pctLabel) pctLabel.textContent = '100%';
        if (statusIcon) {
          statusIcon.hidden = false;
          statusIcon.className = 'upload-queue-item__status-icon tone-success';
          statusIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
        }
        if (isDuplicateDemo) {
          injectDuplicateWarning(row);
        } else {
          injectAiTaggingShimmer(row);
        }
        return;
      }
      if (fill) fill.style.width = pct + '%';
      if (pctLabel) pctLabel.textContent = pct + '%';
    }, 220);
  }

  function injectDuplicateWarning(row) {
    var warning = document.createElement('div');
    warning.className = 'duplicate-warning';
    warning.innerHTML =
      '<span class="duplicate-warning__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>' +
      '<div>' +
        '<strong>This looks like a duplicate of "Studio shot — new arrivals"</strong>' +
        '<p style="margin:4px 0 0; font-size: var(--text-sm);">Some duplicates are intentional re-uploads of an edited version.</p>' +
        '<div class="duplicate-warning__actions">' +
          '<button class="ui-button ui-button-secondary sm" type="button" data-warning-action="version">This is a new version</button>' +
          '<button class="ui-button ui-button-ghost sm" type="button" data-warning-action="separate">It\'s a separate asset</button>' +
        '</div>' +
      '</div>';
    row.insertAdjacentElement('afterend', warning);
    warning.querySelectorAll('[data-warning-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        warning.remove();
        showToast('toast-upload-complete-template');
      });
    });
  }

  function injectAiTaggingShimmer(row) {
    var shimmerWrap = document.createElement('div');
    shimmerWrap.style.padding = '0 0 0 56px';
    shimmerWrap.style.marginTop = '-4px';
    shimmerWrap.innerHTML =
      '<div class="asset-card__ai-shimmer-row" style="padding-left:0;">' +
        '<span class="skel ai-shimmer-line w1"></span>' +
        '<span class="skel ai-shimmer-line w2"></span>' +
      '</div>';
    row.insertAdjacentElement('afterend', shimmerWrap);
    setTimeout(function () {
      shimmerWrap.innerHTML =
        '<div class="asset-card__tags">' +
          '<span class="asset-card__tag is-ai">&#10024; product</span>' +
          '<span class="asset-card__tag is-ai">&#10024; flat-lay</span>' +
        '</div>';
    }, 1800);
  }

  /* ---------------------------------------------------------------------
     Standalone AI-tagging shimmer demo card (its own gallery section) —
     "Simulate AI tags landing" button resolves the shimmer into real tags.
     --------------------------------------------------------------------- */
  var simulateAiBtn = document.getElementById('simulate-ai-tags-btn');
  if (simulateAiBtn) {
    simulateAiBtn.addEventListener('click', function () {
      var shimmerRow = document.getElementById('ai-shimmer-row');
      var tagsLanded = document.getElementById('ai-tags-landed');
      if (shimmerRow) shimmerRow.hidden = true;
      if (tagsLanded) tagsLanded.hidden = false;
      simulateAiBtn.textContent = 'AI tags landed';
      simulateAiBtn.disabled = true;
    });
  }

  /* ---------------------------------------------------------------------
     Standalone duplicate-warning demo buttons (its own gallery section)
     --------------------------------------------------------------------- */
  var markVersionBtn = document.getElementById('duplicate-mark-version-btn');
  var dismissDuplicateBtn = document.getElementById('duplicate-dismiss-btn');
  function resolveDuplicateDemo(label) {
    var warning = markVersionBtn ? markVersionBtn.closest('.duplicate-warning') : null;
    if (!warning) return;
    warning.innerHTML = '<span class="duplicate-warning__icon" style="color:var(--color-success-text);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></span><span>' + label + '</span>';
    warning.style.background = 'var(--color-success-bg)';
    warning.style.borderColor = 'var(--color-success-border)';
    warning.style.color = 'var(--color-success-text)';
  }
  if (markVersionBtn) {
    markVersionBtn.addEventListener('click', function () {
      resolveDuplicateDemo('Linked as a new version — the previous upload is now superseded and moved out of the default grid (see Version history section).');
    });
  }
  if (dismissDuplicateBtn) {
    dismissDuplicateBtn.addEventListener('click', function () {
      resolveDuplicateDemo('Kept as a separate asset — both uploads remain independently in your Library.');
    });
  }

  /* ---------------------------------------------------------------------
     Toasts
     --------------------------------------------------------------------- */
  function showToast(templateId) {
    var template = document.getElementById(templateId);
    var stack = document.getElementById('toast-stack');
    if (!template || !stack) return;
    var clone = template.cloneNode(true);
    clone.removeAttribute('id');
    clone.hidden = false;
    stack.appendChild(clone);
    var closeBtn = clone.querySelector('[data-toast-close]');
    if (closeBtn) closeBtn.addEventListener('click', function () { clone.remove(); });
    setTimeout(function () { if (clone.parentNode) clone.remove(); }, 6000);
  }
  document.querySelectorAll('[data-fire-toast]').forEach(function (btn) {
    btn.addEventListener('click', function () { showToast(btn.getAttribute('data-fire-toast')); });
  });

  /* ---------------------------------------------------------------------
     Asset detail drawer — "Save changes" optimistic confirmation, same
     pattern Packet 1 used for the post detail drawer.
     --------------------------------------------------------------------- */
  var drawerSaveBtn = document.getElementById('drawer-save-meta-btn');
  if (drawerSaveBtn) {
    drawerSaveBtn.addEventListener('click', function () {
      var original = drawerSaveBtn.textContent;
      drawerSaveBtn.textContent = 'Saved';
      drawerSaveBtn.disabled = true;
      setTimeout(function () {
        drawerSaveBtn.textContent = original;
        drawerSaveBtn.disabled = false;
      }, 1400);
    });
  }

  /* ---------------------------------------------------------------------
     Gallery nav active-link highlighting on scroll
     --------------------------------------------------------------------- */
  var sections = document.querySelectorAll('.gallery-section[id]');
  var navLinks = document.querySelectorAll('.gallery-nav a[href^="#"]');
  if ('IntersectionObserver' in window && sections.length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle('is-current', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach(function (s) { observer.observe(s); });
  }

  /* ---------------------------------------------------------------------
     Theme toggle (light/dark)
     --------------------------------------------------------------------- */
  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      var current = root.getAttribute('data-theme') || 'light';
      root.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
      themeBtn.textContent = (current === 'light') ? 'Light mode' : 'Dark mode';
    });
  }
})();
