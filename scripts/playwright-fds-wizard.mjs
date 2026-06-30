/**
 * Playwright: walk the full SpecSkeletonWizard for Herrenknecht Segment Wagon.
 * Steps: Metadata → Control System → Machine Hierarchy → Operating Modes → Alarms → Confirm
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE       = "http://localhost:5174";
const PROJECT_ID = "01d1f5b5-8d00-4d69-a04e-dea8ff77976b";
const SLOW       = 600;

const shots = join(process.cwd(), "scripts", "playwright-shots");
mkdirSync(shots, { recursive: true });

let idx = 0;
const snap = async (page, label) => {
  const file = join(shots, `wiz-${String(++idx).padStart(2,"0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸  ${label}`);
};

const go = (ms = SLOW) => new Promise(r => setTimeout(r, ms));

const step = (n, title) =>
  console.log(`\n${"─".repeat(62)}\n  STEP ${n}: ${title}\n${"─".repeat(62)}`);

// ─────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: SLOW });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();
page.setDefaultTimeout(60000);

// ─────────────────────────────────────────────────────────────────────────────
step(1, "Login + navigate to spec");
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(BASE);
await go(1200);
if (page.url().includes("login")) {
  await page.locator("#email").fill("kasper.simonsen@pac-technologies.com.au");
  await go(300);
  await page.locator("#password").fill("123456");
  await go(300);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(u => !u.toString().includes("login"), { timeout: 15000 });
}
console.log("  ✅  Logged in");

await page.goto(`${BASE}/specs?projectId=${PROJECT_ID}`);
await page.waitForLoadState("networkidle");
await go(800);

// Click the SRE-2601 spec card
const specCard = page.locator("p.font-mono").filter({ hasText: /SRE-2601/ }).first();
await specCard.waitFor({ state: "visible", timeout: 10000 });
await specCard.click();
await go(1000);
await snap(page, "spec-detail");
console.log("  URL:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(2, "Open skeleton wizard");
// ─────────────────────────────────────────────────────────────────────────────

// Find Phase 2 CTA — scroll down to it
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await go(600);

const wizardLink = page.getByRole("link", { name: /open wizard/i }).or(
  page.getByRole("link", { name: /open/i }).filter({ hasText: /wizard/i })
).or(
  page.locator("a[href*='wizard'], a[href*='skeleton']")
).first();

const wizLinkCount = await wizardLink.count();
console.log(`  Wizard link count: ${wizLinkCount}`);
if (wizLinkCount > 0) {
  await wizardLink.click();
  await page.waitForLoadState("networkidle");
  await go(1200);
}
await snap(page, "wizard-opened");

// Check we can see the step indicator
const stepIndicator = page.locator("text=/Document Metadata/i").first();
const wizardVisible = await stepIndicator.isVisible().catch(() => false);
console.log(`  Wizard visible: ${wizardVisible}`);

// ─────────────────────────────────────────────────────────────────────────────
step(3, "Wizard Step 0 — Document Metadata");
// ─────────────────────────────────────────────────────────────────────────────
await snap(page, "step0-metadata");

// Fill required fields that might be empty
const metaFills = [
  { id: "client_name",    value: "Herrenknecht AG" },
  { id: "project_number", value: "SRE-2601" },
  { id: "issued_by",      value: "K. Simonsen" },
  { id: "verified_by",    value: "K. Simonsen" },
  { id: "approved_by",    value: "K. Simonsen" },
];

for (const { id, value } of metaFills) {
  const input = page.locator(`#${id}`).first();
  if (await input.count() > 0 && await input.isVisible()) {
    const cur = await input.inputValue();
    if (!cur.trim()) {
      await input.click();
      await input.fill(value);
      console.log(`  ✏️  ${id} = "${value}"`);
      await go(200);
    } else {
      console.log(`  ✔  ${id} already = "${cur}"`);
    }
  }
}

await snap(page, "step0-filled");

// Click Next
const nextBtn = page.getByRole("button", { name: /next/i }).first();
await nextBtn.click();
await go(700);
await snap(page, "step1-control");
console.log("  → Step 1: Control System");

// ─────────────────────────────────────────────────────────────────────────────
step(4, "Wizard Step 1 — Control System");
// ─────────────────────────────────────────────────────────────────────────────

// PLC Model text field
const plcInput = page.locator("#plc_model").first();
if (await plcInput.count() > 0) {
  const cur = await plcInput.inputValue();
  if (!cur.trim()) {
    await plcInput.fill("Siemens S7-1200 CPU 1214C");
    console.log("  ✏️  plc_model = Siemens S7-1200 CPU 1214C");
    await go(300);
  } else {
    console.log(`  ✔  plc_model = "${cur}"`);
  }
}

// HMI Type Select
const hmiTrigger = page.locator("[class*='SelectTrigger']").or(
  page.getByRole("combobox")
).first();
if (await hmiTrigger.count() > 0 && await hmiTrigger.isVisible()) {
  const hmiVal = await hmiTrigger.textContent();
  if (!hmiVal?.match(/WinCC|None|Other/)) {
    await hmiTrigger.click();
    await go(400);
    const hmiOpt = page.getByRole("option", { name: "WinCC Unified" });
    if (await hmiOpt.count() > 0) {
      await hmiOpt.click();
      console.log("  ✏️  hmi_type = WinCC Unified");
    }
    await go(300);
  }
}

// Comms Protocol Select — second Select on the page
const selects = page.getByRole("combobox");
const selectCount = await selects.count();
if (selectCount >= 2) {
  const commsSelect = selects.nth(1);
  const commsVal = await commsSelect.textContent();
  if (!commsVal?.match(/PROFINET|OPC|Ethernet|None/)) {
    await commsSelect.click();
    await go(400);
    const profinetOpt = page.getByRole("option", { name: "PROFINET" });
    if (await profinetOpt.count() > 0) {
      await profinetOpt.click();
      console.log("  ✏️  comms_protocol = PROFINET");
    }
    await go(300);
  }
}

await snap(page, "step1-filled");

await page.getByRole("button", { name: /next/i }).first().click();
await go(800);
await snap(page, "step2-hierarchy");
console.log("  → Step 2: Machine Hierarchy");

// ─────────────────────────────────────────────────────────────────────────────
step(5, "Wizard Step 2 — Machine Hierarchy (AI infer)");
// ─────────────────────────────────────────────────────────────────────────────

// Check what's already there
const hierarchyContent = await page.locator("[class*='min-h']").first().innerText().catch(() => "");
console.log("  Hierarchy preview:", hierarchyContent.slice(0, 200).replace(/\n+/g, " "));

// Click "Infer Hierarchy" (Sparkles button)
const inferBtn = page.getByRole("button", { name: /infer hierarchy|infer/i }).first();
if (await inferBtn.count() > 0) {
  console.log("  🤖  Clicking Infer Hierarchy (AI will organise tags)…");
  await inferBtn.click();
  await snap(page, "hierarchy-inferring");

  // Wait for inference (up to 45s)
  const inferSpinner = page.locator("[class*='animate-spin']").first();
  try {
    await inferSpinner.waitFor({ state: "detached", timeout: 45000 });
    console.log("  ✅  Hierarchy inferred");
  } catch {
    console.log("  ⚠️  Inference taking longer — continuing");
  }
  await go(1000);
} else {
  console.log("  ℹ️  No Infer button — using tags as-parsed from register");
}

await snap(page, "step2-hierarchy-done");

// Check subsystems
const subNames = await page.locator("[class*='font-mono']").allTextContents();
console.log("  Subsystems visible:", subNames.filter(t => t.trim()).slice(0, 10).join(" | "));

await page.getByRole("button", { name: /next/i }).first().click();
await go(800);
await snap(page, "step3-states");
console.log("  → Step 3: Operating Modes");

// ─────────────────────────────────────────────────────────────────────────────
step(6, "Wizard Step 3 — Operating Modes (AI infer)");
// ─────────────────────────────────────────────────────────────────────────────

// Check existing states
const stateRows = await page.locator("tr, [class*='state-row'], [class*='grid'] p").allTextContents();
console.log("  Existing states:", stateRows.filter(t => t.trim()).slice(0, 12).join(" | "));

// Click "Infer" button if no states yet, or if we want AI to suggest them
const inferStatesBtn = page.getByRole("button", { name: /infer/i }).first();
if (await inferStatesBtn.count() > 0) {
  console.log("  🤖  Clicking Infer States…");
  await inferStatesBtn.click();
  await snap(page, "states-inferring");

  // Wait for inference
  try {
    const spinner = page.locator("[class*='animate-spin']").first();
    await spinner.waitFor({ state: "detached", timeout: 45000 });
    console.log("  ✅  States inferred");
  } catch {
    console.log("  ⚠️  State inference taking longer — continuing");
  }
  await go(1000);
}

await snap(page, "step3-states-done");
const stateNames = await page.locator("[class*='font-mono'], td, [class*='state']").allTextContents();
console.log("  States:", stateNames.filter(t => t.trim()).slice(0, 15).join(" | "));

await page.getByRole("button", { name: /next/i }).first().click();
await go(800);
await snap(page, "step4-alarms");
console.log("  → Step 4: Alarm Configuration");

// ─────────────────────────────────────────────────────────────────────────────
step(7, "Wizard Step 4 — Alarm Configuration (pre-filled)");
// ─────────────────────────────────────────────────────────────────────────────
// Default alarm tiers are pre-filled — just observe and proceed
const alarmInputs = await page.locator("input:visible").all();
const alarmTierVals = await Promise.all(alarmInputs.map(i => i.inputValue()));
console.log("  Alarm tier inputs:", alarmTierVals.filter(v => v.trim()).join(" | "));
await snap(page, "step4-alarms-view");

await page.getByRole("button", { name: /next/i }).first().click();
await go(800);
await snap(page, "step5-review");
console.log("  → Step 5: Review & Confirm");

// ─────────────────────────────────────────────────────────────────────────────
step(8, "Wizard Step 5 — Review & Confirm");
// ─────────────────────────────────────────────────────────────────────────────
const reviewText = await page.locator("[class*='min-h']").first().innerText().catch(() => "");
console.log("  Review summary:", reviewText.slice(0, 400).replace(/\n+/g, " "));
await snap(page, "step5-review-content");

// Click Confirm & Save
const confirmBtn = page.getByRole("button", { name: /confirm.*save|confirm/i }).first();
if (await confirmBtn.count() > 0) {
  console.log("  🖱  Clicking Confirm & Save…");
  await confirmBtn.click();
  await page.waitForLoadState("networkidle");
  await go(2000);
  console.log("  ✅  Wizard complete — spec confirmed");
} else {
  console.log("  ⚠️  Confirm button not found");
  const btns = await page.locator("button:visible").allTextContents();
  console.log("  Buttons:", btns.filter(b => b.trim()).join(" | "));
}

await snap(page, "wizard-complete");
console.log("  URL after confirm:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(9, "Phase 3 unlocked — showing co-author entry point");
// ─────────────────────────────────────────────────────────────────────────────
await go(1000);
await snap(page, "phases-post-wizard");

const phase3Link = page.getByRole("link", { name: /open co-author|co-author/i }).first();
if (await phase3Link.count() > 0) {
  console.log("  ✅  Phase 3 (Co-Author) is now unlocked");
  const href = await phase3Link.getAttribute("href");
  console.log("  Co-author URL:", href);
} else {
  const allLinks = await page.locator("a:visible").allTextContents();
  console.log("  Links:", allLinks.filter(t => t.trim()).slice(0, 15).join(" | "));
}

// ─────────────────────────────────────────────────────────────────────────────
step(10, "Open for supervision");
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(62));
console.log("  Wizard complete. Browser staying open.");
console.log("  Phase 3 Co-Author is next — click 'Open Co-Author'");
console.log("  to start the AI interview for the Herrenknecht spec.");
console.log("  Ctrl+C to close.");
console.log("═".repeat(62) + "\n");

await new Promise(() => {});
