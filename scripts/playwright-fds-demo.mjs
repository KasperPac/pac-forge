/**
 * Playwright demo: FDS Builder for Herrenknecht Segment Wagon (project sre-2601).
 * headless:false + slowMo — watch every action in the browser.
 *
 * Steps:
 *  1. Open app, wait for manual login
 *  2. Go to /specs → project picker → search "sre-2601" → click it
 *  3. Create new spec: "Herrenknecht Segment Wagon SRL S-1427/28"
 *  4. Walk Phase 1 (instrument register) — explain what to upload
 *  5. Show Phase 2 (skeleton wizard) entry point
 *  6. Keep browser open for manual supervision
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:5174";
const SLOW =  800;

const shots = join(process.cwd(), "scripts", "playwright-shots");
mkdirSync(shots, { recursive: true });

let idx = 0;
async function snap(page, label) {
  const file = join(shots, `${String(++idx).padStart(2,"0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸  ${label}`);
  return file;
}

const go = (ms = SLOW) => new Promise(r => setTimeout(r, ms));

function step(n, title) {
  console.log(`\n${"─".repeat(62)}\n  STEP ${n}: ${title}\n${"─".repeat(62)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: SLOW });
const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await ctx.newPage();
page.setDefaultTimeout(30000);

// ─────────────────────────────────────────────────────────────────────────────
step(1, "Open app");
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(BASE);
await go(1500);
await snap(page, "app-home");

// ─────────────────────────────────────────────────────────────────────────────
step(2, "Auto-login");
// ─────────────────────────────────────────────────────────────────────────────
if (page.url().includes("login")) {
  console.log("  ✏️  Filling email…");
  await page.locator("#email").fill("kasper.simonsen@pac-technologies.com.au");
  await go(400);
  console.log("  ✏️  Filling password…");
  await page.locator("#password").fill("123456");
  await go(400);
  console.log("  🖱  Submitting…");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(u => !u.toString().includes("login"), { timeout: 15000 });
}
console.log("  ✅  Logged in.");
await go(800);
await snap(page, "logged-in");

// ─────────────────────────────────────────────────────────────────────────────
step(3, "Spec Builder → Project Picker → search sre-2601");
// ─────────────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/specs`);
await page.waitForLoadState("networkidle");
await go(800);
await snap(page, "project-picker");

// The ProjectPicker renders a search input and a list of project rows
const searchInput = page.getByPlaceholder(/search/i).or(
  page.locator("input[type=search], input[type=text]")
).first();

if (await searchInput.count() > 0) {
  console.log("  🔍  Searching for sre-2601…");
  await searchInput.click();
  await searchInput.fill("sre-2601");
  await go(600);
  await snap(page, "project-picker-search");
}

// Click the sre-2601 project row (it navigates to /specs?projectId=<uuid>)
const projectRow = page.locator("text=/sre-2601/i").first();
await projectRow.waitFor({ state: "visible", timeout: 10000 });
console.log("  ✅  Found sre-2601 — clicking it");
await projectRow.click();
await page.waitForLoadState("networkidle");
await go(800);
await snap(page, "project-selected");
console.log("  URL:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(4, "Spec list — click + to create a new spec");
// ─────────────────────────────────────────────────────────────────────────────

// The + button is a DialogTrigger in the left panel header
// Its icon is a Plus lucide icon — aria-label or title may say "New Spec"
const plusBtn = page.locator("button").filter({ has: page.locator("svg") })
  .filter({ hasText: "" })  // icon-only buttons
  .or(page.getByTitle(/new spec|add/i))
  .or(page.getByRole("button", { name: /^\+$/ }));

// Also try finding by the Dialog trigger structure — it's next to the spec title
// Fallback: look for any button in the header area with a plus SVG
let openedDialog = false;

// Try the + IconButton in the left panel header
for (const selector of [
  'button[title*="spec" i]',
  'button[title*="new" i]',
  'button[aria-label*="new" i]',
  'button[aria-label*="add" i]',
]) {
  const btn = page.locator(selector).first();
  if (await btn.count() > 0) {
    console.log(`  🖱  Clicking ${selector}`);
    await btn.click();
    openedDialog = true;
    await go(700);
    break;
  }
}

if (!openedDialog) {
  // Last resort: look for any button containing a + or Plus SVG in a sensible area
  const svgBtns = page.locator(".w-72 button, [class*='panel'] button, [class*='sidebar'] button").all();
  const btns = await svgBtns;
  console.log(`  Found ${btns.length} buttons in panel area`);
  for (const btn of btns) {
    const txt = await btn.textContent();
    const title = await btn.getAttribute("title");
    console.log(`    button: text="${txt?.trim()}" title="${title}"`);
  }
  // Click the first non-icon button that could be "new"
  const allBtns = await page.locator("button:visible").all();
  for (const btn of allBtns) {
    const html = await btn.innerHTML();
    if (html.includes("Plus") || html.includes("plus") || (await btn.getAttribute("title") ?? "").toLowerCase().includes("new")) {
      console.log("  Clicking button with Plus icon");
      await btn.click();
      openedDialog = true;
      await go(700);
      break;
    }
  }
}

await snap(page, "spec-list-with-plus");

// ─────────────────────────────────────────────────────────────────────────────
step(5, "Create Spec dialog — fill in details");
// ─────────────────────────────────────────────────────────────────────────────

// Wait for the dialog to appear (DialogContent)
const dialog = page.locator("[role=dialog]").first();
const dialogVisible = await dialog.isVisible().catch(() => false);

if (dialogVisible) {
  console.log("  ✅  Dialog is open");
  await snap(page, "create-spec-dialog-open");

  // Fill doc code (auto-generated but may be editable)
  const docCodeInput = dialog.locator("input").first();
  const docCodeVal = await docCodeInput.inputValue();
  console.log(`  Doc code (auto): "${docCodeVal}"`);

  // Fill title
  const titleInput = dialog.locator("input[placeholder*='title' i], input[placeholder*='name' i]").or(
    dialog.locator("input").nth(1)
  ).first();
  await titleInput.waitFor({ state: "visible", timeout: 5000 });
  await titleInput.fill("Herrenknecht Segment Wagon SRL S-1427/28");
  console.log("  ✏️  Title filled");
  await go(400);
  await snap(page, "create-spec-dialog-filled");

  // Click Create
  const createBtn = dialog.getByRole("button", { name: /create/i }).first();
  if (await createBtn.count() > 0) {
    await createBtn.click();
    await page.waitForLoadState("networkidle");
    await go(1200);
    console.log("  ✅  Spec created");
  }
} else {
  console.log("  ⚠️  Dialog not detected — dumping visible buttons:");
  const allBtns = await page.locator("button:visible").allTextContents();
  console.log(" ", allBtns.filter(b => b.trim()).join(" | "));
}

await snap(page, "after-create-spec");
console.log("  URL:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(6, "Phase 1 — Instrument Register upload section");
// ─────────────────────────────────────────────────────────────────────────────
await go(600);
await snap(page, "phase-1-register-section");

const phase1Text = await page.locator("text=/instrument register/i").first();
if (await phase1Text.count() > 0) {
  console.log("  ✅  Phase 1 (Instrument Register) section is visible");
  // Scroll to it
  await phase1Text.scrollIntoViewIfNeeded();
  await go(500);
  await snap(page, "phase-1-visible");
  console.log("\n  ┌─────────────────────────────────────────────────────────┐");
  console.log("  │  What to upload for Herrenknecht Segment Wagon:         │");
  console.log("  │                                                          │");
  console.log("  │  Convert 'HK Segment Wagon IO Description.docx' to CSV │");
  console.log("  │  with columns: tag | io_address | signal_type | desc    │");
  console.log("  │                                                          │");
  console.log("  │  IO count: 30 DI, 10 DO, 5 Profinet devices (VSDs +    │");
  console.log("  │            encoders) — ~45 rows total                   │");
  console.log("  └─────────────────────────────────────────────────────────┘");
} else {
  console.log("  ⚠️  Phase 1 section not found at this URL. May need spec selection first.");
  const headings = await page.locator("h1,h2,h3").allTextContents();
  console.log("  Headings:", headings.join(" | "));
}

// ─────────────────────────────────────────────────────────────────────────────
step(7, "Final state — overview of all phases");
// ─────────────────────────────────────────────────────────────────────────────
await go(400);
await snap(page, "all-phases-overview");

const allHeadings = await page.locator("h1,h2,h3,h4").allTextContents();
const allBtns = await page.locator("button:visible").allTextContents();
console.log("  Headings:", allHeadings.filter(t=>t.trim()).join(" | "));
console.log("  Buttons:", allBtns.filter(b=>b.trim()).join(" | "));
console.log("  URL:", page.url());

// ─────────────────────────────────────────────────────────────────────────────
step(8, "Open for manual supervision");
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(62));
console.log("  Browser is staying open. Screenshots in scripts/playwright-shots/");
console.log("  Interact manually — or Ctrl+C here to close.");
console.log("═".repeat(62) + "\n");

await new Promise(() => {});
