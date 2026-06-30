/**
 * Playwright FDS demo — Phase 1 upload + Phase 2 skeleton wizard.
 * Uses the file-chooser intercept pattern so React's onChange fires correctly.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

const BASE       = "http://localhost:5174";
const PROJECT_ID = "01d1f5b5-8d00-4d69-a04e-dea8ff77976b";
const CSV_PATH   = resolve(process.cwd(), "scripts", "hk-segment-wagon-io.csv");
const SLOW       = 700;

const shots = join(process.cwd(), "scripts", "playwright-shots");
mkdirSync(shots, { recursive: true });

let idx = 0;
async function snap(page, label) {
  const file = join(shots, `p2-${String(++idx).padStart(2,"0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸  ${label}`);
}

const go = (ms = SLOW) => new Promise(r => setTimeout(r, ms));

function step(n, title) {
  console.log(`\n${"─".repeat(62)}\n  STEP ${n}: ${title}\n${"─".repeat(62)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: SLOW });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();
page.setDefaultTimeout(60000);

// ─────────────────────────────────────────────────────────────────────────────
step(1, "Auto-login");
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(BASE);
await go(1500);
if (page.url().includes("login")) {
  await page.locator("#email").fill("kasper.simonsen@pac-technologies.com.au");
  await go(300);
  await page.locator("#password").fill("123456");
  await go(300);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(u => !u.toString().includes("login"), { timeout: 15000 });
}
console.log("  ✅  Logged in");

// ─────────────────────────────────────────────────────────────────────────────
step(2, "Navigate to sre-2601 spec list and select the Herrenknecht spec");
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/specs?projectId=${PROJECT_ID}`);
await page.waitForLoadState("networkidle");
await go(1000);
await snap(page, "spec-list");

// Click the spec card (matches SRE-2601 doc code text)
const specCard = page.locator("p.font-mono.text-xs").filter({ hasText: /SRE-2601/ }).first();
if (await specCard.count() > 0) {
  console.log("  🖱  Clicking spec card");
  await specCard.click();
} else {
  // Fallback: click first group item in the list
  await page.locator("[class*='group']").first().click();
}
await go(1000);
await snap(page, "spec-detail");
console.log("  URL:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(3, "Phase 1 — Upload instrument register via file chooser intercept");
// ─────────────────────────────────────────────────────────────────────────────
console.log(`  📄  File: ${CSV_PATH}`);

// Scroll the upload card into view
const uploadCard = page.locator(".border-dashed").first();
await uploadCard.waitFor({ state: "visible", timeout: 10000 });
await uploadCard.scrollIntoViewIfNeeded();
await go(500);
await snap(page, "upload-card-visible");

// Intercept the file chooser BEFORE clicking the card
console.log("  🖱  Clicking upload dropzone (intercept file chooser)…");
const [fileChooser] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 10000 }),
  uploadCard.click(),
]);
console.log("  📎  File chooser opened — setting CSV file");
await fileChooser.setFiles(CSV_PATH);

// Now wait for the AI parse to complete — it calls the Edge Function (Haiku)
// Can take 10–30s. Poll for the success badge ("N tags parsed").
console.log("  ⏳  Waiting for AI parse (up to 45s)…");
await snap(page, "parsing-started");

const tagsBadge = page.locator("text=/tags parsed/i").first();
try {
  await tagsBadge.waitFor({ state: "visible", timeout: 45000 });
  const badgeText = await tagsBadge.textContent();
  console.log(`  ✅  Parse complete: "${badgeText?.trim()}"`);
} catch {
  console.log("  ⚠️  Parse took longer than 45s or failed — checking for error");
  const errMsg = page.locator("[class*='destructive']").first();
  if (await errMsg.count() > 0) {
    console.log("  ❌  Error:", await errMsg.textContent());
  }
}
await snap(page, "phase-1-complete");

// Log subsystems extracted
const subsystemCards = await page.locator(".grid .border").allTextContents();
console.log("  Subsystems detected:", subsystemCards.filter(t => t.trim()).join(" | "));

// ─────────────────────────────────────────────────────────────────────────────
step(4, "Phase 2 — Open Skeleton Wizard");
// ─────────────────────────────────────────────────────────────────────────────
await go(1000);

// Scroll down to find the Phase 2 card
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await go(600);
await snap(page, "all-phases-scroll");

// The wizard open button / link
const wizardCta = page.getByRole("link", { name: /open wizard|skeleton wizard|open/i }).or(
  page.getByRole("button", { name: /open wizard|skeleton wizard/i })
).first();

const ctaCount = await wizardCta.count();
console.log(`  Wizard CTA buttons: ${ctaCount}`);

if (ctaCount > 0) {
  console.log("  🖱  Opening skeleton wizard…");
  await wizardCta.click();
  await page.waitForLoadState("networkidle");
  await go(1500);
  await snap(page, "wizard-open");
  console.log("  URL:", page.url());
} else {
  // Phase 2 might still be locked if phase 1 is processing
  const locked = page.locator("text=/locked|upload instrument/i").first();
  if (await locked.count() > 0) {
    console.log("  ⚠️  Phase 2 still locked — Phase 1 may not have saved yet");
  }
  await snap(page, "wizard-cta-not-found");
  const allLinks = await page.locator("a:visible, button:visible").allTextContents();
  console.log("  All links/buttons:", allLinks.filter(t => t.trim()).slice(0, 30).join(" | "));
}

// ─────────────────────────────────────────────────────────────────────────────
step(5, "Skeleton Wizard — fill document metadata");
// ─────────────────────────────────────────────────────────────────────────────
await go(500);
const h2 = await page.locator("h1, h2").first().textContent().catch(() => "");
console.log(`  Page heading: "${h2}"`);
await snap(page, "wizard-step");

// Fill whatever fields are visible and empty
const metaFields = [
  { id: "client_name",     value: "Herrenknecht AG" },
  { id: "project_number",  value: "SRE-2601" },
  { id: "issued_by",       value: "K. Simonsen" },
];
for (const { id, value } of metaFields) {
  const input = page.locator(`#${id}, input[name="${id}"]`).first();
  if (await input.count() > 0 && await input.isVisible()) {
    const cur = await input.inputValue();
    if (!cur.trim()) {
      await input.fill(value);
      console.log(`  ✏️  ${id}: "${value}"`);
      await go(250);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
step(6, "Open for supervision — wizard is live");
// ─────────────────────────────────────────────────────────────────────────────
await snap(page, "final-state");
console.log("\n" + "═".repeat(62));
console.log("  Browser open — continue the wizard manually.");
console.log("  Ctrl+C to close.");
console.log("═".repeat(62) + "\n");

await new Promise(() => {});
