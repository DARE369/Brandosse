/* QA-only: interactive functional verification of 5 calendar/library features.
   Usage: node scripts/qa-feature-verify.cjs */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

function loadEnv(file) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3017";
const EMAIL = process.env.QA_EMAIL || "brandosse.qa@brandosse.test";
const PW = process.env.QA_PASSWORD || "Brandosse-QA-2026!";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const results = [];

function log(label, status, detail) {
  results.push({ label, status, detail });
  console.log(`\n[${status}] ${label}\n  ${detail || ""}`);
}

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");
  await page.waitForURL("**/app/**", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") {
      consoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push("PAGEERROR: " + err.message);
  });

  await login(page);

  // ───────────────────────────── TEST 1: Archive (Library) ─────────────────────
  try {
    await page.goto(BASE + "/app/library", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, "t1-library-initial.png"), fullPage: true });

    // Go to Drafts section to find/create a draft post.
    await page.click("button:has-text('Drafts')");
    await page.waitForTimeout(800);
    let draftCard = page.locator(".library-card").filter({ has: page.locator("button:has-text('Archive')") }).first();
    let draftCount = await draftCard.count();

    if (draftCount === 0) {
      // No draft exists — create one via New Post -> back out isn't easy; use Upload with caption to create a draft post quickly.
      // Simpler: navigate to calendar and create a draft via month/day "+", then return.
      await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      // try clicking month view + a day cell plus button as a draft creator (also serves test 3 prep)
      const monthBtn = page.locator(".cal3-view-switcher__btn", { hasText: 'Month' }).first();
      if (await monthBtn.count()) {
        await monthBtn.click();
        await page.waitForTimeout(800);
        const plusBtn = page.locator(".cal3-month-cell__add").first();
        if (await plusBtn.count()) {
          await plusBtn.click();
          await page.waitForTimeout(1200);
        }
      }
      await page.goto(BASE + "/app/library", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.click("button:has-text('Drafts')");
      await page.waitForTimeout(800);
      draftCard = page.locator(".library-card").filter({ has: page.locator("button:has-text('Archive')") }).first();
      draftCount = await draftCard.count();
    }

    if (draftCount === 0) {
      log("1. Archive (Library)", "BLOCKED", "No draft post available/creatable to test archive flow.");
    } else {
      await page.screenshot({ path: path.join(OUT, "t1-before-archive.png"), fullPage: true });
      await draftCard.locator("button:has-text('Archive')").click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, "t1-after-archive-click.png"), fullPage: true });

      // Check it disappeared from "All Items"
      await page.click("button:has-text('All Items')");
      await page.waitForTimeout(600);
      const allItemsText = await page.locator(".library-left-rail").innerText();

      // Check Archived rail item with count
      const archivedRailBtn = page.locator("button:has-text('Archived')");
      const archivedRailText = await archivedRailBtn.innerText();
      await archivedRailBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, "t1-archived-section.png"), fullPage: true });

      const archivedCard = page.locator(".library-card").first();
      const archivedCardButtons = await archivedCard.locator(".library-card-actions button").allInnerTexts();
      const statusBadgeText = await archivedCard.locator(".library-card-status").innerText().catch(() => "");

      const hasUnarchive = archivedCardButtons.some((t) => /unarchive/i.test(t));
      const onlyExpectedButtons = archivedCardButtons.every((t) => /unarchive|duplicate|delete/i.test(t));
      const badgeSaysArchived = /archived/i.test(statusBadgeText);
      const badgeSaysDraft = /^draft$/i.test(statusBadgeText.trim());

      let detail = `Archived rail label: "${archivedRailText.replace(/\s+/g, " ")}". Card buttons: [${archivedCardButtons.join(", ")}]. Status badge text: "${statusBadgeText}".`;

      if (!hasUnarchive || !onlyExpectedButtons || !badgeSaysArchived || badgeSaysDraft) {
        log("1. Archive (Library)", "FAIL", detail + ` hasUnarchive=${hasUnarchive} onlyExpectedButtons=${onlyExpectedButtons} badgeSaysArchived=${badgeSaysArchived} badgeSaysDraft(BUG-CHECK)=${badgeSaysDraft}`);
      } else {
        // Now click Unarchive and confirm it returns to Drafts
        await archivedCard.locator("button:has-text('Unarchive')").click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(OUT, "t1-after-unarchive.png"), fullPage: true });
        await page.click("button:has-text('Drafts')");
        await page.waitForTimeout(600);
        const draftsAfter = await page.locator(".library-card").count();
        if (draftsAfter > 0) {
          log("1. Archive (Library)", "PASS", detail + ` Unarchive returned post to Drafts (count=${draftsAfter}).`);
        } else {
          log("1. Archive (Library)", "FAIL", "Unarchive click did not return post to Drafts section.");
        }
      }
    }
  } catch (err) {
    log("1. Archive (Library)", "FAIL", "Exception: " + err.message);
    await page.screenshot({ path: path.join(OUT, "t1-error.png"), fullPage: true }).catch(() => {});
  }

  // ───────────────────────────── TEST 2: Calendar filters ───────────────────────
  try {
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    // Ensure Week view
    const weekBtn = page.locator("button:has-text('Week')").first();
    if (await weekBtn.count()) await weekBtn.click();
    await page.waitForTimeout(600);

    const filtersBtn = page.locator(".cal3-filters > button.cal3-btn-ghost").first();
    await filtersBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "t2-filters-open.png"), fullPage: true });

    const popover = page.locator(".cal3-filters__popover").first();
    const popoverVisible = await popover.isVisible().catch(() => false);

    const platformSelect = page.locator("#cal3-filter-platform");
    const statusSelect = page.locator("#cal3-filter-status");
    const hasPlatformSelect = await platformSelect.count() > 0;
    const hasStatusSelect = await statusSelect.count() > 0;
    const keepFiltersCheckbox = page.locator(".cal3-filters__remember input[type='checkbox']");
    const resetLink = page.locator(".cal3-filters__reset");
    const hasKeepCheckbox = await keepFiltersCheckbox.count() > 0;
    const hasResetLink = await resetLink.count() > 0;

    let detail = `popoverVisible=${popoverVisible}, hasPlatformSelect=${hasPlatformSelect}, hasStatusSelect=${hasStatusSelect}, hasKeepFiltersCheckbox=${hasKeepCheckbox}, hasResetLink=${hasResetLink}.`;

    if (!popoverVisible || !hasPlatformSelect || !hasStatusSelect || !hasKeepCheckbox || !hasResetLink) {
      log("2. Calendar filters", "FAIL", detail + " Expected popover elements not all found.");
    } else {
      await platformSelect.selectOption("instagram");
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, "t2-platform-selected.png"), fullPage: true });

      const hasBadge = (await page.locator(".cal3-filters__badge").count()) > 0;
      const badgeText = hasBadge ? await page.locator(".cal3-filters__badge").innerText() : "";

      // Click outside to close
      await page.mouse.click(20, 20);
      await page.waitForTimeout(500);
      const stillOpenAfterOutsideClick = await popover.isVisible().catch(() => false);
      await page.screenshot({ path: path.join(OUT, "t2-after-outside-click.png"), fullPage: true });

      // Reopen and reset
      await filtersBtn.click();
      await page.waitForTimeout(500);
      const resetBtn = page.locator(".cal3-filters__reset");
      await resetBtn.click();
      await page.waitForTimeout(500);
      const platformSelectAfterReset = await platformSelect.inputValue().catch(() => "?");
      const statusSelectAfterReset = await statusSelect.inputValue().catch(() => "?");
      await page.screenshot({ path: path.join(OUT, "t2-after-reset.png"), fullPage: true });

      detail += ` hasBadge=${hasBadge} badgeText="${badgeText}". closesOnOutsideClick=${!stillOpenAfterOutsideClick}. afterResetPlatformValue="${platformSelectAfterReset}" afterResetStatusValue="${statusSelectAfterReset}".`;

      if (stillOpenAfterOutsideClick) {
        log("2. Calendar filters", "FAIL", detail + " Popover did NOT close on outside click.");
      } else if (platformSelectAfterReset !== "all" || statusSelectAfterReset !== "all") {
        log("2. Calendar filters", "FAIL", detail + " Reset filters did not restore both selects to 'all'.");
      } else if (!hasBadge) {
        log("2. Calendar filters", "FAIL", detail + " No visible count badge on Filters button after selecting a platform.");
      } else {
        log("2. Calendar filters", "PASS", detail);
      }
    }
  } catch (err) {
    log("2. Calendar filters", "FAIL", "Exception: " + err.message);
    await page.screenshot({ path: path.join(OUT, "t2-error.png"), fullPage: true }).catch(() => {});
  }

  // ───────────────────────────── TEST 3: Month view ─────────────────────────────
  let weekLabelBeforeMonth = null;
  try {
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    const headerLabelLoc = page.locator(".cal3-header__week-label").first();
    weekLabelBeforeMonth = await headerLabelLoc.innerText().catch(() => null);

    // Navigate forward one week first, so we can check "switch back to Week" preserves browsed week.
    const nextBtn = page.locator("button[aria-label='Next week']").first();
    if (await nextBtn.count()) {
      await nextBtn.click();
      await page.waitForTimeout(600);
    }
    const weekLabelAfterNext = await headerLabelLoc.innerText().catch(() => null);

    const monthBtn = page.locator(".cal3-view-switcher__btn", { hasText: 'Month' }).first();
    await monthBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "t3-month-view.png"), fullPage: true });

    const monthGrid = page.locator(".cal3-month").first();
    const hasMonthGrid = await monthGrid.count() > 0;
    const dayCells = page.locator(".cal3-month-cell");
    const dayCellCount = await dayCells.count();
    const weekdayHeaders = await page.locator(".cal3-month-header__cell").allInnerTexts().catch(() => []);
    const monthHeaderText = await headerLabelLoc.innerText().catch(() => "");

    let detail = `hasMonthGrid=${hasMonthGrid}, dayCellCount=${dayCellCount}, weekdayHeaders=[${weekdayHeaders.join(",")}], headerText="${monthHeaderText.replace(/\s+/g,' ')}".`;

    // prev/next navigation by month
    const prevBtn = page.locator("button[aria-label='Previous month']").first();
    await prevBtn.click();
    await page.waitForTimeout(600);
    const monthHeaderAfterPrev = await headerLabelLoc.innerText().catch(() => "");
    await page.screenshot({ path: path.join(OUT, "t3-month-prev.png"), fullPage: true });
    detail += ` headerAfterPrevMonth="${monthHeaderAfterPrev.replace(/\s+/g,' ')}".`;

    // go back to original month, then try clicking a "+" on a day cell
    await page.locator("button[aria-label='Next month']").first().click();
    await page.waitForTimeout(600);

    const dayAddBtn = page.locator(".cal3-month-cell__add").first();
    const hasDayAddBtn = await dayAddBtn.count() > 0;
    if (hasDayAddBtn) {
      await dayAddBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, "t3-month-day-add-click.png"), fullPage: true });
    }
    detail += ` hasDayAddBtn=${hasDayAddBtn}.`;

    // Switch back to Week and confirm it shows the browsed week (not reset to today)
    const weekBtn2 = page.locator(".cal3-view-switcher__btn", { hasText: 'Week' }).first();
    await weekBtn2.click();
    await page.waitForTimeout(800);
    const weekLabelAfterReturn = await headerLabelLoc.innerText().catch(() => null);
    await page.screenshot({ path: path.join(OUT, "t3-back-to-week.png"), fullPage: true });
    detail += ` weekLabelAfterNext="${weekLabelAfterNext}" weekLabelAfterReturn="${weekLabelAfterReturn}".`;

    const monthLooksRight = hasMonthGrid && dayCellCount === 42 && weekdayHeaders.length === 7 && /\b(20\d\d)\b/.test(monthHeaderText);
    const navigatesByMonth = monthHeaderAfterPrev !== monthHeaderText && monthHeaderAfterPrev !== "";
    const weekPreserved = weekLabelAfterReturn === weekLabelAfterNext;

    if (!monthLooksRight) {
      log("3. Month view", "FAIL", detail + " Month grid structure/label looks wrong.");
    } else if (!navigatesByMonth) {
      log("3. Month view", "FAIL", detail + " Prev arrow did not change month label distinctly.");
    } else if (!weekPreserved) {
      log("3. Month view", "FAIL", detail + " Switching back to Week did NOT preserve the previously browsed week.");
    } else {
      log("3. Month view", "PASS", detail);
    }
  } catch (err) {
    log("3. Month view", "FAIL", "Exception: " + err.message);
    await page.screenshot({ path: path.join(OUT, "t3-error.png"), fullPage: true }).catch(() => {});
  }

  // ───────────────────────────── TEST 4: Drag-and-drop scheduling ───────────────
  try {
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const weekBtn3 = page.locator("button:has-text('Week')").first();
    if (await weekBtn3.count()) await weekBtn3.click();
    await page.waitForTimeout(800);

    await page.screenshot({ path: path.join(OUT, "t4-before-drag.png"), fullPage: true });

    const draftTrayItem = page.locator(".cal3-draft-card").first();
    const hasDraftItem = await draftTrayItem.count() > 0;

    if (!hasDraftItem) {
      log("4. Drag-and-drop scheduling", "BLOCKED", "No draft items found in the bottom tray to drag.");
    } else {
      // Pick an hour cell that's empty (no post chip inside) to avoid ambiguous drop target.
      const gridCell = page.locator(".cal3-hour-cell").nth(10);
      const hasGridCell = await gridCell.count() > 0;

      if (!hasGridCell) {
        log("4. Drag-and-drop scheduling", "BLOCKED", "Could not locate an hourly grid cell target.");
      } else {
        const srcBox = await draftTrayItem.boundingBox();
        const dstBox = await gridCell.boundingBox();

        if (!srcBox || !dstBox) {
          log("4. Drag-and-drop scheduling", "BLOCKED", "Could not compute bounding boxes for drag source/target.");
        } else {
          // Manual pointer-based DnD sequence (dnd-kit needs real pointer events with movement steps)
          await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(150);
          await page.mouse.move(srcBox.x + srcBox.width / 2 + 20, srcBox.y + srcBox.height / 2 - 20, { steps: 5 });
          await page.waitForTimeout(100);
          await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 10 });
          await page.waitForTimeout(150);
          await page.mouse.move(dstBox.x + dstBox.width / 2 + 2, dstBox.y + dstBox.height / 2 + 2, { steps: 3 });
          await page.waitForTimeout(150);
          await page.mouse.up();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: path.join(OUT, "t4-after-drag.png"), fullPage: true });

          const toastVisible = await page.locator("[class*='toast']").filter({ hasText: /schedul|moved|success/i }).count();
          log("4. Drag-and-drop scheduling", toastVisible > 0 ? "PASS" : "FAIL",
            `toastVisible=${toastVisible}. Check t4-before-drag.png / t4-after-drag.png visually to confirm post landed on grid.`);
        }
      }
    }
  } catch (err) {
    log("4. Drag-and-drop scheduling", "FAIL", "Exception: " + err.message);
    await page.screenshot({ path: path.join(OUT, "t4-error.png"), fullPage: true }).catch(() => {});
  }

  // ───────────────────────────── TEST 5: Platform reassignment (PostPanel) ──────
  try {
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const weekBtn4 = page.locator("button:has-text('Week')").first();
    if (await weekBtn4.count()) await weekBtn4.click();
    await page.waitForTimeout(800);

    const postCard = page.locator(".cal3-post-cell").first();
    const hasPostCard = await postCard.count() > 0;

    if (!hasPostCard) {
      log("5. Platform reassignment (PostPanel)", "BLOCKED", "No post card found on Week grid to open.");
    } else {
      await postCard.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, "t5-panel-open.png"), fullPage: true });

      const platformSelect = page.locator(".cal3-platform-select");
      const hasDropdown = await platformSelect.count() > 0;
      const staticBadge = page.locator(".cal3-panel__header .cal3-u-text-xs.cal3-u-muted").last();

      if (hasDropdown) {
        const optionsCount = await platformSelect.locator("option").count();
        const initialValue = await platformSelect.inputValue();
        // pick a different option than current
        const allValues = await platformSelect.locator("option").evaluateAll((opts) => opts.map((o) => o.value));
        const newValue = allValues.find((v) => v !== initialValue) || allValues[0];
        await platformSelect.selectOption(newValue);
        await page.waitForTimeout(400);
        const saveBtn = page.locator("button:has-text('Save changes')");
        const saveBtnEnabled = await saveBtn.isEnabled().catch(() => false);
        await saveBtn.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(OUT, "t5-after-save.png"), fullPage: true });

        // re-open panel (close then click post again) to confirm persisted
        await page.locator(".cal3-icon-btn[aria-label='Close panel']").click();
        await page.waitForTimeout(500);
        await postCard.click();
        await page.waitForTimeout(800);
        const platformSelectAfterReopen = page.locator(".cal3-platform-select");
        const valueAfterReopen = await platformSelectAfterReopen.inputValue().catch(() => "?");
        await page.screenshot({ path: path.join(OUT, "t5-after-reopen.png"), fullPage: true });

        const persisted = valueAfterReopen === newValue;
        log("5. Platform reassignment (PostPanel)", persisted ? "PASS" : "FAIL",
          `optionsCount=${optionsCount}, initialValue=${initialValue}, newValue=${newValue}, saveBtnEnabledBeforeClick=${saveBtnEnabled}, valueAfterReopen=${valueAfterReopen}, persisted=${persisted}.`);
      } else {
        const badgeText = await staticBadge.innerText().catch(() => "");
        log("5. Platform reassignment (PostPanel)", "BLOCKED/INFO",
          `No dropdown rendered (canReassignPlatform false, likely <2 connected accounts at click time). Static badge text="${badgeText}". This is correct behavior if <2 accounts, otherwise check seeding.`);
      }
    }
  } catch (err) {
    log("5. Platform reassignment (PostPanel)", "FAIL", "Exception: " + err.message);
    await page.screenshot({ path: path.join(OUT, "t5-error.png"), fullPage: true }).catch(() => {});
  }

  await browser.close();

  console.log("\n\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(`${r.status.padEnd(10)} ${r.label}`);
  }
  console.log("\n========== CONSOLE ERRORS ==========");
  if (consoleErrors.length === 0) {
    console.log("None observed.");
  } else {
    consoleErrors.forEach((e, i) => console.log(`${i + 1}. ${e}`));
  }
})();
