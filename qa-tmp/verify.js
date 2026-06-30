// Throwaway Playwright verification script for two bug fixes:
//  Test A: normal scheduled post still draggable on calendar
//  Test B: published post is drag-locked on calendar (critical regression test)
//  Test C: Library archive / unarchive flow
//
// Run: node qa-tmp/verify.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const EMAIL = 'brandosse.qa@brandosse.test';
const PASSWORD = 'Brandosse-QA-2026!';
const SHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PUBLISHED_FIXTURE_ID = '53be1c41-4ecf-46ed-904e-a783cdcaf2f8';
const DRAFT_FIXTURE_ID = '7d6e24fb-2e89-4108-a6ce-05c132ad9e66';

let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  const file = path.join(SHOT_DIR, `${String(shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[screenshot] ${file}`);
  return file;
}

const consoleErrors = [];
const networkErrors = [];

function wireDiagnostics(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log('[console.error]', msg.text());
    }
  });
  page.on('response', async (res) => {
    try {
      const status = res.status();
      const url = res.url();
      if (status >= 400 && (url.includes('/rest/v1/posts') || url.includes('supabase'))) {
        let body = '';
        try { body = await res.text(); } catch {}
        networkErrors.push({ url, status, body });
        console.log(`[network ${status}]`, url, body.slice(0, 500));
      }
    } catch {}
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err));
    console.log('[pageerror]', err);
  });
}

async function login(page) {
  console.log('=== LOGIN ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await shot(page, 'login-filled');
  await page.click('button[type="submit"].auth-submit');
  await page.waitForURL(/\/app\//, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log('Post-login URL:', page.url());
}

async function dragChip(page, chipLocator, targetCellLocator) {
  const chipBox = await chipLocator.boundingBox();
  const targetBox = await targetCellLocator.boundingBox();
  if (!chipBox || !targetBox) throw new Error('Could not get bounding box for drag');

  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + Math.min(10, chipBox.height / 2); // grab near top of chip
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit needs movement past an activation distance/constraint -- do several
  // incremental intermediate moves rather than one jump.
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(800);
}

async function ensureWeekHasFixtures(page) {
  // Look for the published fixture chip; if not present, navigate weeks until found
  // (or bail after a few tries either direction).
  const findPublished = () => page.locator(`[title*="drag is disabled"]`).first();

  for (let i = 0; i < 6; i++) {
    const headerText = await page.locator('.cal3-header__week-label').first().innerText().catch(() => '');
    console.log('Current week label:', headerText);
    const anyFixtureChip = page.locator('.cal3-post-cell', { hasText: 'QA FIXTURE' });
    const count = await anyFixtureChip.count();
    console.log('QA FIXTURE chips visible this week:', count);
    if (count >= 2) return true; // published + failed fixtures both expected same week
    await page.click('button[aria-label="Next week"]');
    await page.waitForTimeout(600);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  wireDiagnostics(page);

  const report = { testA: {}, testB: {}, testC: {} };

  try {
    await login(page);

    console.log('\n=== NAVIGATE TO CALENDAR ===');
    await page.goto(`${BASE_URL}/app/calendar`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'calendar-initial-load');

    // Ensure week view (should be default)
    const weekBtn = page.locator('.cal3-view-switcher__btn', { hasText: 'Week' });
    if (await weekBtn.count()) {
      const isActive = await weekBtn.first().evaluate((el) => el.className.includes('--active'));
      console.log('Week view button active:', isActive);
      if (!isActive) {
        await weekBtn.first().click();
        await page.waitForTimeout(800);
      }
    }

    const found = await ensureWeekHasFixtures(page);
    console.log('Found week with fixtures:', found);
    await shot(page, 'calendar-week-with-fixtures');

    // ============ TEST B FIRST (published fixture is what we observe in DOM before any mutation) ============
    console.log('\n=== TEST B: published post drag-lock ===');
    const publishedChip = page.locator('.cal3-post-cell', { hasText: 'QA FIXTURE — published post' }).first();
    const publishedCount = await publishedChip.count();
    report.testB.chipFound = publishedCount > 0;
    console.log('Published fixture chip found:', publishedCount);

    if (publishedCount > 0) {
      const classAttr = await publishedChip.getAttribute('class');
      const titleAttr = await publishedChip.getAttribute('title');
      report.testB.classAttr = classAttr;
      report.testB.titleAttr = titleAttr;
      report.testB.hasLockedClass = (classAttr || '').includes('cal3-post-cell--locked');
      console.log('class:', classAttr);
      console.log('title:', titleAttr);

      await publishedChip.scrollIntoViewIfNeeded();
      await shot(page, 'testB-published-chip-before-drag');

      // record original screen position to verify it does NOT move
      const beforeBox = await publishedChip.boundingBox();

      // pick a target cell - some other day/hour cell far from current position
      const targetCell = page.locator('.cal3-hour-cell').nth(40);
      await dragChip(page, publishedChip, targetCell);

      await page.waitForTimeout(1000);
      await shot(page, 'testB-after-drag-attempt');

      // check for toast text
      const toastLocator = page.locator('text=/Published posts can.?t be rescheduled/i');
      const toastVisible = await toastLocator.count();
      report.testB.toastSeen = toastVisible > 0;
      if (toastVisible) {
        report.testB.toastText = await toastLocator.first().innerText();
        console.log('Toast seen:', report.testB.toastText);
      } else {
        console.log('No matching error toast found in DOM at check time.');
      }

      // re-locate chip after drag attempt and compare position
      const afterChip = page.locator('.cal3-post-cell', { hasText: 'QA FIXTURE — published post' }).first();
      const afterCount = await afterChip.count();
      report.testB.chipStillPresentSamePlace = afterCount > 0;
      if (afterCount > 0) {
        const afterBox = await afterChip.boundingBox();
        report.testB.beforeBox = beforeBox;
        report.testB.afterBox = afterBox;
        report.testB.movedPx = beforeBox && afterBox
          ? Math.hypot(afterBox.x - beforeBox.x, afterBox.y - beforeBox.y)
          : null;
        console.log('Before box:', beforeBox, 'After box:', afterBox, 'Moved px:', report.testB.movedPx);
      }
    }

    // ============ TEST A: normal scheduled post should drag fine ============
    console.log('\n=== TEST A: normal scheduled post drag ===');
    // d2f4ebb0 row has empty caption, instagram, scheduled -- find via data attribute fallback:
    // chip text shows post.title || caption.slice(0,50) || 'Untitled' -- caption is empty string so it'll show 'Untitled'
    // We need a more specific locator. Let's grab all post cells and inspect.
    const allChips = page.locator('.cal3-post-cell');
    const chipCount = await allChips.count();
    console.log('Total post chips visible this week:', chipCount);
    let scheduledChip = null;
    let scheduledChipInfo = null;
    for (let i = 0; i < chipCount; i++) {
      const chip = allChips.nth(i);
      const cls = await chip.getAttribute('class');
      const text = await chip.innerText();
      console.log(`chip[${i}] class="${cls}" text="${text.replace(/\n/g, ' | ')}"`);
      if (cls && cls.includes('cal3-post-cell--scheduled') && !cls.includes('--locked')) {
        scheduledChip = chip;
        scheduledChipInfo = { index: i, cls, text };
        break;
      }
    }

    report.testA.chipFound = !!scheduledChip;
    if (scheduledChip) {
      report.testA.chipInfo = scheduledChipInfo;
      await scheduledChip.scrollIntoViewIfNeeded();
      await shot(page, 'testA-scheduled-chip-before-drag');

      const beforeBox = await scheduledChip.boundingBox();
      // target: a different cell, e.g. nth(10) hour cell (different day/hour)
      const targetCell = page.locator('.cal3-hour-cell').nth(10);
      const targetBoxPre = await targetCell.boundingBox();
      report.testA.targetCellBox = targetBoxPre;

      await dragChip(page, scheduledChip, targetCell);
      await page.waitForTimeout(1000);
      await shot(page, 'testA-after-drag-attempt');

      const successToast = page.locator('text=/Post rescheduled/i');
      const successToastVisible = await successToast.count();
      report.testA.successToastSeen = successToastVisible > 0;
      console.log('Success toast seen:', successToastVisible > 0);

      const errorToast = page.locator('text=/Failed to reschedule/i');
      report.testA.errorToastSeen = (await errorToast.count()) > 0;

      // Determine where it landed visually
      const afterChips = page.locator('.cal3-post-cell--scheduled');
      report.testA.afterChipCount = await afterChips.count();
    } else {
      console.log('WARNING: could not locate a plain scheduled, non-locked chip to drag for Test A.');
    }

    // Bonus: Cmd+K reschedule attempt on published post
    console.log('\n=== BONUS: Cmd+K reschedule on published fixture ===');
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('k');
      await page.keyboard.up('Control');
      await page.waitForTimeout(600);
      await shot(page, 'cmdk-opened');
      const cmdInput = page.locator('input, textarea').filter({ hasNotText: '' }).first();
      // Try the visible command bar input - look for a generic text input within an open dialog/modal
      const visibleInput = page.locator('[role="dialog"] input, [role="dialog"] textarea, .cmdk-input, input[type="text"]:visible').first();
      const hasInput = await visibleInput.count();
      if (hasInput) {
        await visibleInput.fill('Reschedule QA FIXTURE — published post to tomorrow at 3pm');
        await shot(page, 'cmdk-typed');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        await shot(page, 'cmdk-after-submit');
        const cmdToast = page.locator("text=/Published posts can.?t be rescheduled/i");
        report.testB.cmdkToastSeen = (await cmdToast.count()) > 0;
        if (report.testB.cmdkToastSeen) {
          report.testB.cmdkToastText = await cmdToast.first().innerText();
        }
        console.log('Cmd+K reschedule toast seen:', report.testB.cmdkToastSeen);
      } else {
        console.log('Could not find Cmd+K input field - skipping bonus test.');
        report.testB.cmdkAttempted = false;
      }
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      console.log('Cmd+K bonus test errored (non-fatal):', e.message);
    }

    // ============ TEST C: Library archive/unarchive ============
    console.log('\n=== TEST C: Library archive/unarchive ===');
    await page.goto(`${BASE_URL}/app/library`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'library-initial-load');

    // Ensure on "All Items" / default section
    const allBtn = page.locator('aside.library-left-rail button', { hasText: /^All/ }).first();
    if (await allBtn.count()) {
      await allBtn.click();
      await page.waitForTimeout(500);
    }
    await shot(page, 'library-all-section');

    const draftCard = page.locator('.library-card', { hasText: 'QA FIXTURE — draft post for archive test' }).first();
    report.testC.draftCardFoundInAll = (await draftCard.count()) > 0;
    console.log('Draft fixture card found in All section:', report.testC.draftCardFoundInAll);

    if (report.testC.draftCardFoundInAll) {
      await draftCard.scrollIntoViewIfNeeded();
      await shot(page, 'testC-draft-card-before-archive');

      const archiveBtn = draftCard.locator('button', { hasText: 'Archive' }).first();
      await archiveBtn.click();
      await page.waitForTimeout(1200);
      await shot(page, 'testC-after-archive-click');

      const archiveSuccessToast = page.locator('text=/Post archived/i');
      report.testC.archiveToastSeen = (await archiveSuccessToast.count()) > 0;
      console.log('Archive success toast seen:', report.testC.archiveToastSeen);

      const archiveErrorToast = page.locator('text=/Failed to archive/i');
      report.testC.archiveErrorToastSeen = (await archiveErrorToast.count()) > 0;

      // confirm disappeared from All section
      const stillInAll = page.locator('.library-card', { hasText: 'QA FIXTURE — draft post for archive test' });
      report.testC.disappearedFromAll = (await stillInAll.count()) === 0;
      console.log('Disappeared from All section:', report.testC.disappearedFromAll);

      // Switch to Archived section
      const archivedBtn = page.locator('aside.library-left-rail button', { hasText: 'Archived' }).first();
      await archivedBtn.click();
      await page.waitForTimeout(800);
      await shot(page, 'testC-archived-section');

      const inArchived = page.locator('.library-card', { hasText: 'QA FIXTURE — draft post for archive test' });
      report.testC.foundInArchivedSection = (await inArchived.count()) > 0;
      console.log('Found in Archived section:', report.testC.foundInArchivedSection);

      if (report.testC.foundInArchivedSection) {
        const cardInArchived = inArchived.first();
        const unarchiveBtn = cardInArchived.locator('button', { hasText: 'Unarchive' }).first();
        const unarchiveBtnCount = await unarchiveBtn.count();
        report.testC.unarchiveButtonFound = unarchiveBtnCount > 0;
        if (unarchiveBtnCount > 0) {
          await unarchiveBtn.click();
          await page.waitForTimeout(1200);
          await shot(page, 'testC-after-unarchive-click');

          const unarchiveToast = page.locator('text=/moved back to drafts/i');
          report.testC.unarchiveToastSeen = (await unarchiveToast.count()) > 0;
          console.log('Unarchive success toast seen:', report.testC.unarchiveToastSeen);

          const unarchiveErrorToast = page.locator('text=/Failed to unarchive/i');
          report.testC.unarchiveErrorToastSeen = (await unarchiveErrorToast.count()) > 0;

          // still in archived section?
          const stillInArchived = page.locator('.library-card', { hasText: 'QA FIXTURE — draft post for archive test' });
          report.testC.disappearedFromArchived = (await stillInArchived.count()) === 0;
          console.log('Disappeared from Archived section:', report.testC.disappearedFromArchived);

          // Go back to All / Drafts to see where it landed
          await allBtn.click();
          await page.waitForTimeout(800);
          await shot(page, 'testC-back-in-all-after-unarchive');
          const backInAll = page.locator('.library-card', { hasText: 'QA FIXTURE — draft post for archive test' });
          report.testC.backInAllSection = (await backInAll.count()) > 0;
          console.log('Back in All section after unarchive:', report.testC.backInAllSection);
        }
      }
    }

  } catch (err) {
    console.error('FATAL ERROR during test run:', err);
    await shot(page, 'fatal-error-state');
    report.fatalError = String(err && err.stack || err);
  } finally {
    report.consoleErrors = consoleErrors;
    report.networkErrors = networkErrors;
    fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2));
    console.log('\n=== REPORT WRITTEN to qa-tmp/report.json ===');
    await browser.close();
  }
})();
