/**
 * Playwright: upload the pre-filled HK register (.xlsx, template format) to the
 * SRE-2601 spec and open the skeleton wizard. Visible browser, left open for
 * supervision.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

const BASE = "http://localhost:5174";
const PROJECT_ID = "01d1f5b5-8d00-4d69-a04e-dea8ff77976b";
const FILE_PATH = resolve(process.cwd(), "scripts", "hk-segment-wagon-register.xlsx");
const SLOW = 600;

const shots = join(process.cwd(), "scripts", "playwright-shots");
mkdirSync(shots, { recursive: true });
let idx = 0;
const snap = async (page, label) => {
  await page.screenshot({ path: join(shots, `hk-${String(++idx).padStart(2, "0")}-${label}.png`) });
  console.log(`  📸  ${label}`);
};
const go = (ms = SLOW) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, slowMo: SLOW });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

console.log("STEP 1: login");
await page.goto(BASE);
await go(1200);
if (page.url().includes("login")) {
  await page.locator("#email").fill("kasper.simonsen@pac-technologies.com.au");
  await go(200);
  await page.locator("#password").fill("123456");
  await go(200);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.toString().includes("login"), { timeout: 15000 });
}
console.log("  ✅ logged in");

console.log("STEP 2: open SRE-2601 spec");
await page.goto(`${BASE}/specs?projectId=${PROJECT_ID}`);
await page.waitForLoadState("networkidle");
await go(800);
const card = page.locator("p.font-mono").filter({ hasText: /SRE-2601/ }).first();
await card.waitFor({ state: "visible", timeout: 10000 });
await card.click();
await go(1000);
await snap(page, "spec-detail");

console.log("STEP 3: upload register (.xlsx) via file-chooser intercept");
const dropzone = page.locator(".border-dashed").first();
await dropzone.waitFor({ state: "visible", timeout: 10000 });
await dropzone.scrollIntoViewIfNeeded();
await go(400);
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 10000 }),
  dropzone.click(),
]);
await chooser.setFiles(FILE_PATH);
console.log(`  📎 ${FILE_PATH}`);
console.log("  ⏳ waiting for parse (up to 60s)…");
await snap(page, "parsing");
try {
  await page.locator("text=/tags parsed/i").first().waitFor({ state: "visible", timeout: 60000 });
  const badge = await page.locator("text=/tags parsed/i").first().textContent();
  console.log(`  ✅ parse: "${badge?.trim()}"`);
} catch {
  console.log("  ⚠️ no 'tags parsed' badge within 60s — check the UI");
}
await snap(page, "parsed");
const groups = await page.locator(".grid .border").allTextContents();
console.log("  Groups detected:", groups.filter((t) => t.trim()).slice(0, 12).join(" | "));

console.log("STEP 4: re-select the spec so the wizard re-mounts from the freshly-saved register");
// Re-selecting (NOT reload — reload deselects) forces a fresh wizard mount whose
// useState initializer seeds the hierarchy from the new register.
await page.goto(`${BASE}/specs?projectId=${PROJECT_ID}`);
await page.waitForLoadState("networkidle");
await go(1000);
await page.locator("p.font-mono").filter({ hasText: /SRE-2601/ }).first().click();
await go(1800);
const wizHeader = page.locator("text=/Spec Skeleton Wizard/i").first();
await wizHeader.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
await wizHeader.scrollIntoViewIfNeeded().catch(() => {});
await go(600);
await snap(page, "wizard-inline");

// The wizard renders inline (no 'open' link). Walk Step 0 -> 1 -> 2.
const next = () => page.getByRole("button", { name: /^next$/i }).first();

console.log("  Wizard Step 0 — metadata (seeded from spec); filling any blanks");
for (const [id, val] of [
  ["client_name", "SRE Electrical"],
  ["project_number", "SRE-2601"],
  ["issued_by", "K. Simonsen"],
]) {
  const inp = page.locator(`#${id}`).first();
  if ((await inp.count()) > 0 && (await inp.isVisible()) && !(await inp.inputValue()).trim()) {
    await inp.fill(val);
    await go(150);
  }
}
await snap(page, "step0");
if ((await next().count()) > 0) { await next().click(); await go(700); }

console.log("  Wizard Step 1 — control system");
const plc = page.locator("#plc_model").first();
if ((await plc.count()) > 0 && !(await plc.inputValue()).trim()) {
  await plc.fill("Siemens S7-1200 CPU 1214C");
  await go(200);
}
await snap(page, "step1");
if ((await next().count()) > 0) { await next().click(); await go(900); }

console.log("  Wizard Step 2 — Machine Hierarchy");
await go(600);
await snap(page, "step2-hierarchy");
const hierText = await page.locator("body").innerText().catch(() => "");
const found = ["Carriage Drive","Carriage Motors","Carriage Brake","Rotator Drive","Rotator Motor","Rotator Brake","Safety","Operator Controls","Travel Limit"]
  .filter((a) => hierText.includes(a));
console.log("  Assemblies visible on Step 2:", found.join(" | ") || "(none detected in text)");
console.log("  Subsystem title present:", /Segment Wagon/i.test(hierText));

console.log("\n" + "=".repeat(60));
console.log("  Browser open at Step 2 (Machine Hierarchy).");
console.log("  Expect 1 subsystem (Segment Wagon) + 9 assemblies.");
console.log("  Continue Next -> states -> alarms -> Confirm & Save manually.");
console.log("  Ctrl+C to close.");
console.log("=".repeat(60) + "\n");
await new Promise(() => {});
