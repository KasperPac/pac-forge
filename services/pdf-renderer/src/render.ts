import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tplDir = resolve(__dirname, "templates");

Handlebars.registerHelper("money", (v: unknown) => {
  if (v == null || typeof v !== "number" || Number.isNaN(v)) return "";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(v);
});

Handlebars.registerHelper("displayDate", (iso: unknown) => {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const mon = d.toLocaleString("en-AU", { month: "long" });
  const yr = d.getFullYear();
  return `${day} ${mon} ${yr}`;
});

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

Handlebars.registerHelper("or", (...args: unknown[]) => {
  // The last arg is the Handlebars options object; ignore it.
  for (let i = 0; i < args.length - 1; i++) {
    const v = args[i];
    if (v != null && v !== "") return v;
  }
  return "";
});

Handlebars.registerHelper(
  "citationFor",
  function (section: string, id: unknown, options: Handlebars.HelperOptions) {
    if (typeof id !== "string" || !id) return undefined;
    const root = options.data?.root as
      | {
          snapshot?: {
            citations?: Array<{ target_section: string; target_doc_id: string }>;
          };
        }
      | undefined;
    const citations = root?.snapshot?.citations ?? [];
    return citations.find(
      (c) => c.target_section === section && c.target_doc_id === id,
    );
  },
);

Handlebars.registerHelper("markdown", (text: unknown) => {
  if (typeof text !== "string" || !text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return new Handlebars.SafeString(paragraphs.join(""));
});

let cachedTemplate: HandlebarsTemplateDelegate | null = null;
let cachedAssets: { tokensCss: string; componentsCss: string; quoteCss: string } | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (cachedTemplate) return cachedTemplate;
  Handlebars.registerPartial(
    "header",
    await readFile(resolve(tplDir, "partials/_header.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "footer",
    await readFile(resolve(tplDir, "partials/_footer.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "signature",
    await readFile(resolve(tplDir, "partials/_signature.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "amends",
    await readFile(resolve(tplDir, "partials/_amends.html"), "utf8"),
  );
  const html = await readFile(resolve(tplDir, "pac-quote.html"), "utf8");
  cachedTemplate = Handlebars.compile(html, { noEscape: false });
  return cachedTemplate;
}

async function getAssets() {
  if (cachedAssets) return cachedAssets;
  const [tokensCss, componentsCss, quoteCss] = await Promise.all([
    readFile(resolve(tplDir, "tokens.css"), "utf8"),
    readFile(resolve(tplDir, "components.css"), "utf8"),
    readFile(resolve(tplDir, "pac-quote.css"), "utf8"),
  ]);
  cachedAssets = { tokensCss, componentsCss, quoteCss };
  return cachedAssets;
}

export async function renderSnapshotToHtml(snapshot: unknown): Promise<string> {
  const template = await getTemplate();
  const assets = await getAssets();
  return template({
    snapshot,
    _tokensCss: assets.tokensCss,
    _componentsCss: assets.componentsCss,
    _quoteCss: assets.quoteCss,
  });
}

async function launchBrowser(): Promise<Browser> {
  const explicitPath = process.env.CHROMIUM_PATH;
  const executablePath = explicitPath || (await chromium.executablePath());
  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

export async function renderSnapshotToPdf(snapshot: unknown): Promise<Buffer> {
  const html = await renderSnapshotToHtml(snapshot);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "25mm", bottom: "25mm", left: "25mm", right: "25mm" },
      printBackground: true,
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
