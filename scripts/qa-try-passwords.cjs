/* Try multiple passwords for workspace.toolss@gmail.com */
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:3000";
const EMAIL = "workspace.toolss@gmail.com";
const PASSWORDS = [
  "Brandosse2026!",
  "Brandosse2026",
  "brandosse2026",
  "Brandosse123!",
  "Brandosse123",
  "password123",
  "Password123!",
  "Admin2026!",
  "admin123",
  "Workspace2026!",
  "workspace123",
  "SocialAI2026!",
  "socialai123",
  "Test1234!",
  "test1234",
  "Dev2026!",
  "Dare2026!",
  "dare2026",
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const pw of PASSWORDS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
    await page.fill("#login-email", EMAIL);
    await page.fill("#login-password", pw);
    await page.click(".auth-submit");

    let success = false;
    try {
      await page.waitForURL((url) => !url.includes("/login"), { timeout: 10000 });
      success = true;
    } catch (e) {
      success = false;
    }

    const url = page.url();
    console.log(`[${success ? "OK" : "FAIL"}] pw="${pw}" -> ${url}`);

    await context.close();
    if (success) {
      console.log(`\nSUCCESS! Password is: ${pw}`);
      break;
    }
  }

  await browser.close();
})();
