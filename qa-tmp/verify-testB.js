// Focused re-run of Test B only (published post drag-lock), with corrected
// selector (chip displays post.title "QA Fixture Published", not the caption).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const EMAIL = 'brandosse.qa@brandosse.test';
const PASSWORD = 'Brandosse-QA-2026!';
const SHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let shotN = 100;
async function shot(page, name) {
  shotN += 1;
  const file = path.join(SHOT_DIR, `${shotN}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[screenshot] ${file}`);
}

async function dragChip(page, chipLocator, targetCellLocator) {
  const chipBox = await chipLocator.boundingBox();
  const targetBox = await targetCellLocator.boundingBox();
  if (!chipBox || !targetBox) throw new Error('Could not get bounding box for drag');

  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + Math.min(10, chipBox.height / 2);
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(x, y, { steps: 3 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(1000);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const report = {};

  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASSWORD);
    await page.click('button[type="submit"].auth-submit');
    await page.waitForURL(/\/app\//, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.goto(`${BASE_URL}/app/calendar`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Confirm week label covers the fixture week
    const headerText = await page.locator('.cal3-header__week-label').first().innerText();
    console.log('Week label:', headerText);
    report.weekLabel = headerText;

    const publishedChip = page.locator('.cal3-post-cell', { hasText: 'QA Fixture Published' }).first();
    const found = (await publishedChip.count()) > 0;
    report.chipFound = found;
    console.log('Published chip found:', found);

    if (found) {
      const classAttr = await publishedChip.getAttribute('class');
      const titleAttr = await publishedChip.getAttribute('title');
      report.classAttr = classAttr;
      report.titleAttr = titleAttr;
      report.hasLockedClass = (classAttr || '').includes('cal3-post-cell--locked');
      console.log('class attr:', classAttr);
      console.log('title attr:', titleAttr);

      await publishedChip.scrollIntoViewIfNeeded();
      await shot(page, 'published-chip-dom-state');

      // Zoom into the DOM around the chip for inspection
      const outerHTML = await publishedChip.evaluate((el) => el.outerHTML);
      report.outerHTML = outerHTML;
      console.log('Outer HTML:\n', outerHTML);

      const beforeBox = await publishedChip.boundingBox();
      report.beforeBox = beforeBox;

      // pick a clearly different, visible target cell (a later hour, different day)
      const targetCell = page.locator('.cal3-hour-cell').nth(60);
      const targetBox = await targetCell.boundingBox();
      report.targetBox = targetBox;

      console.log('Attempting drag of published/locked chip...');
      await dragChip(page, publishedChip, targetCell);
      await shot(page, 'after-drag-attempt-on-locked-chip');

      const errorToast = page.locator("text=/Published posts can.?t be rescheduled by dragging/i");
      const errorToastCount = await errorToast.count();
      report.errorToastSeen = errorToastCount > 0;
      if (errorToastCount > 0) {
        report.errorToastText = await errorToast.first().innerText();
      }
      console.log('Error toast seen:', report.errorToastSeen, report.errorToastText || '');

      const successToast = page.locator('text=/Post rescheduled/i');
      report.successToastSeenIncorrectly = (await successToast.count()) > 0;
      console.log('(should be false) success toast seen:', report.successToastSeenIncorrectly);

      // re-locate, compare position -- must be unchanged
      const afterChip = page.locator('.cal3-post-cell', { hasText: 'QA Fixture Published' }).first();
      const afterCount = await afterChip.count();
      report.chipStillFoundAfter = afterCount > 0;
      if (afterCount > 0) {
        const afterBox = await afterChip.boundingBox();
        report.afterBox = afterBox;
        report.movedPx = beforeBox && afterBox ? Math.hypot(afterBox.x - beforeBox.x, afterBox.y - beforeBox.y) : null;
        console.log('Before box:', beforeBox);
        console.log('After box:', afterBox);
        console.log('Moved px:', report.movedPx);
      }

      // Bonus: Cmd+K reschedule attempt
      console.log('\n--- BONUS: Cmd+K reschedule attempt ---');
      await page.keyboard.down('Control');
      await page.keyboard.press('k');
      await page.keyboard.up('Control');
      await page.waitForTimeout(800);
      await shot(page, 'cmdk-open');

      const cmdInput = page.locator('input[placeholder], textarea[placeholder]').first();
      const cmdInputCount = await cmdInput.count();
      report.cmdkInputFound = cmdInputCount > 0;
      if (cmdInputCount > 0) {
        const placeholder = await cmdInput.getAttribute('placeholder');
        console.log('Cmd bar input placeholder:', placeholder);
        await cmdInput.fill('reschedule QA Fixture Published to tomorrow 3pm');
        await shot(page, 'cmdk-typed-reschedule');
        await page.waitForTimeout(800);
        await shot(page, 'cmdk-suggestions');
        // Try pressing Enter to trigger the top suggestion/action
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        await shot(page, 'cmdk-after-enter');

        const cmdErrorToast = page.locator("text=/Published posts can.?t be rescheduled/i");
        report.cmdkErrorToastSeen = (await cmdErrorToast.count()) > 0;
        if (report.cmdkErrorToastSeen) {
          report.cmdkErrorToastText = await cmdErrorToast.first().innerText();
        }
        console.log('Cmd+K error toast seen:', report.cmdkErrorToastSeen, report.cmdkErrorToastText || '');
      } else {
        console.log('No cmd bar input found with placeholder - dumping visible dialog HTML');
        const dialog = page.locator('[role="dialog"]').first();
        if (await dialog.count()) {
          report.cmdkDialogHTML = await dialog.evaluate(el => el.outerHTML.slice(0, 2000));
          console.log(report.cmdkDialogHTML);
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  } catch (err) {
    console.error('ERROR:', err);
    report.error = String(err && err.stack || err);
    await shot(page, 'error-state');
  } finally {
    fs.writeFileSync(path.join(__dirname, 'report-testB.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
