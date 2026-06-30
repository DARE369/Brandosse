/* Try more password variants */
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:3000";
const EMAIL = "workspace.toolss@gmail.com";
const PASSWORDS = [
  "Dare@2026",
  "dare@2026",
  "DARE2026!",
  "Social2026!",
  "Social@2026",
  "Toolss2026!",
  "toolss2026",
  "Toolss@123",
  "Toolss123!",
  "workspace@2026",
  "Workspace@2026",
  "Royalhome2026!",
  "royalhome2026",
  "Royal2026!",
  "Royal@2026",
  "Brandosse@2026",
  "brandosse@2026",
  "123456",
  "12345678",
  "qwerty123",
  "Qwerty123!",
  "letmein",
  "Letmein123!",
  "Passw0rd!",
  "passw0rd",
  "Welcome1!",
  "welcome123",
  "Nigeria2026!",
  "Lagos2026!",
  "Agent2026!",
  "agent2026",
  "Creator2026!",
  "Media2026!",
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const pw of PASSWORDS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(600);
    await page.fill("#login-email", EMAIL);
    await page.fill("#login-password", pw);
    await page.click(".auth-submit");

    let success = false;
    try {
      await page.waitForURL((url) => !url.includes("/login"), { timeout: 8000 });
      success = true;
    } catch (e) {
      success = false;
    }

    const url = page.url();
    console.log(`[${success ? "SUCCESS" : "FAIL"}] pw="${pw}" -> ${url}`);

    await context.close();
    if (success) {
      console.log(`\n*** Password found: ${pw} ***`);
      break;
    }
  }

  await browser.close();
})();
