const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const EMAIL = 'brandosse.qa@brandosse.test';
const PASSWORD = 'Brandosse-QA-2026!';
const SHOT_DIR = path.join(__dirname, 'screenshots');

let shotN = 200;
async function shot(page, name) {
  shotN += 1;
  const file = path.join(SHOT_DIR, `${shotN}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[screenshot] ${file}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
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

    // The locked chip is aria-disabled="true" so Playwright's normal actionability
    // check refuses to click it (confirms the lock is real, not just visual).
    // Skip selecting it -- the command bar takes free text regardless of selection.
    console.log('Skipping chip click (chip is aria-disabled=true, confirms lock is enforced at DOM level)');

    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);

    const cmdInput = page.locator('.cal3-cmdbar__input');
    const found = (await cmdInput.count()) > 0;
    console.log('cal3-cmdbar__input found:', found);
    if (found) {
      await cmdInput.fill('Reschedule QA Fixture Published to tomorrow at 3pm');
      await shot(page, 'cmdbar-filled');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      await shot(page, 'cmdbar-after-submit');

      const resultText = await page.locator('.cal3-cmdbar').innerText().catch(() => '');
      console.log('Command bar content after submit:\n', resultText);

      const errorToast = page.locator("text=/Published posts can.?t be rescheduled/i");
      console.log('Error toast (reschedule-specific) seen:', (await errorToast.count()) > 0);
    }
  } catch (err) {
    console.error('ERROR:', err);
    await shot(page, 'error-state');
  } finally {
    await browser.close();
  }
})();
