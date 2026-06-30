const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const EMAIL = 'brandosse.qa@brandosse.test';
const PASSWORD = 'Brandosse-QA-2026!';
const SHOT_DIR = path.join(__dirname, 'screenshots');

let shotN = 300;
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
  page.on('response', async (res) => {
    const url = res.url();
    if (res.status() >= 400 && url.includes('supabase')) {
      console.log('[network error]', res.status(), url);
    }
  });

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASSWORD);
    await page.click('button[type="submit"].auth-submit');
    await page.waitForURL(/\/app\//, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.goto(`${BASE_URL}/app/calendar`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);

    const cmdInput = page.locator('.cal3-cmdbar__input');
    await cmdInput.fill('Reschedule QA Fixture Published to tomorrow at 3pm');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    await shot(page, 'before-apply-click');

    const applyBtn = page.locator('button', { hasText: 'Apply reschedule' });
    const applyFound = (await applyBtn.count()) > 0;
    console.log('Apply reschedule button found:', applyFound);

    if (applyFound) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
      await shot(page, 'after-apply-click');

      const bodyText = await page.locator('body').innerText();
      const hasLockedError = /Published posts can.?t be rescheduled/i.test(bodyText);
      const hasGenericError = /Failed to/i.test(bodyText);
      console.log('Locked-specific error text present anywhere on page:', hasLockedError);
      console.log('Generic "Failed to..." text present:', hasGenericError);

      // Check toast area specifically
      const toastArea = await page.locator('[class*="toast"], [role="status"]').allInnerTexts().catch(() => []);
      console.log('Toast-area texts:', JSON.stringify(toastArea));
    }
  } catch (err) {
    console.error('ERROR:', err);
    await shot(page, 'error-state');
  } finally {
    await browser.close();
  }
})();
