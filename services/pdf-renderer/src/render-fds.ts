/**
 * FDS document renderer — sibling of render.ts (quotes).
 * Template: templates/pac-fds.html + partials/_fds-*.html + pac-fds.css.
 * Design authority: Docs/FDS-DOC-DESIGN-SYSTEM.md.
 *
 * Importing "./render.js" brings in the shared Handlebars helpers
 * (markdown, displayDate, eq, or) registered at its module top level.
 */
import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { launchBrowser } from "./render.js";
import type { FdsViewModel } from "./fds-viewmodel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tplDir = resolve(__dirname, "templates");

let cachedTemplate: HandlebarsTemplateDelegate | null = null;
let cachedAssets: {
  tokensCss: string;
  fdsCss: string;
  logoFull: string;
} | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (cachedTemplate) return cachedTemplate;
  Handlebars.registerPartial(
    "fdsCover",
    await readFile(resolve(tplDir, "partials/_fds-cover.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "fdsFunctional",
    await readFile(resolve(tplDir, "partials/_fds-functional.html"), "utf8"),
  );
  const html = await readFile(resolve(tplDir, "pac-fds.html"), "utf8");
  cachedTemplate = Handlebars.compile(html, { noEscape: false });
  return cachedTemplate;
}

async function getAssets() {
  if (cachedAssets) return cachedAssets;
  const [tokensCss, fdsCss, logoFullBuf] = await Promise.all([
    readFile(resolve(tplDir, "tokens.css"), "utf8"),
    readFile(resolve(tplDir, "pac-fds.css"), "utf8"),
    readFile(resolve(tplDir, "PacTechnologies.jpg")),
  ]);
  cachedAssets = {
    tokensCss,
    fdsCss,
    logoFull: `data:image/jpeg;base64,${logoFullBuf.toString("base64")}`,
  };
  return cachedAssets;
}

export async function renderFdsToHtml(fds: FdsViewModel): Promise<string> {
  const template = await getTemplate();
  const assets = await getAssets();
  return template({
    fds,
    _tokensCss: assets.tokensCss,
    _fdsCss: assets.fdsCss,
    _logoFull: assets.logoFull,
  });
}

/** Running header/footer per the design system — Puppeteer templates only
 * support inline styles and data-URI images. */
function headerTemplate(fds: FdsViewModel, logo: string): string {
  return `<div style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:4px 18mm 6px;border-bottom:1px solid #E8EBF0;font-size:8px;color:#6B7785;font-family:'Segoe UI',Arial,sans-serif;-webkit-print-color-adjust:exact;">
    <img src="${logo}" style="height:12px;width:auto" />
    <span style="font-family:Consolas,monospace;letter-spacing:.02em">${fds.doc.code} · Rev ${fds.doc.revision} · Commercial in confidence</span>
  </div>`;
}

function footerTemplate(fds: FdsViewModel): string {
  return `<div style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:6px 18mm 4px;border-top:1px solid #E8EBF0;font-size:7.5px;color:#6B7785;font-family:'Segoe UI',Arial,sans-serif;-webkit-print-color-adjust:exact;">
    <span>Pac Technologies Pty Ltd</span>
    <span style="font-family:Consolas,monospace">${fds.doc.title}</span>
    <span>Uncontrolled when printed · <span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`;
}

export async function renderFdsToPdf(fds: FdsViewModel): Promise<Buffer> {
  const html = await renderFdsToHtml(fds);
  const assets = await getAssets();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "22mm", bottom: "18mm", left: "0mm", right: "0mm" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(fds, assets.logoFull),
      footerTemplate: footerTemplate(fds),
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
