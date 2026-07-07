const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:3000";
const EMAIL = "ojomodare369@gmail.com";
const PW = "Jrtmz1'8";
const OUT = path.join(process.cwd(), "qa-shots-overflow");
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");
  await page.waitForURL("**/app/**", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("ERR:", m.text().slice(0,200)); });
  await login(page);

  await page.goto(BASE + "/app/generate", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const histBtn = page.getByText("Session history", { exact: false }).first();
  await histBtn.click();
  await page.waitForTimeout(1000);

  // click first session row (the "Jun 21" one, US icon)
  await page.getByText("Jun 21").first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "clicked-session-1.png") });

  console.log("URL:", page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log("BODY TEXT SNIPPET:\n", bodyText);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
