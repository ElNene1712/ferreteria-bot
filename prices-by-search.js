// prices-by-search.js

// ✅ Lazy-load: NO cargamos Playwright al arrancar el server.
// Solo se importa cuando llamas /search.
let chromium;
function getChromium() {
  if (!chromium) {
    ({ chromium } = require("playwright"));
  }
  return chromium;
}

const SEARCH_URL =
  "https://conveniomarco2.mercadopublico.cl/ferreteria2/productos-de-ferreteria";

const REGIONES = {
  RM: "13",
  VALPO: "5",
  OHIGGINS: "6",
};

async function openSuppliers(page) {
  const btn = page.locator("#go-suppliers-btn");
  if (await btn.count()) {
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 1500 });
    } catch {}
    try {
      await btn.click({ timeout: 4000, force: true });
    } catch {}
  }

  try {
    await page.evaluate(() => {
      const el = document.querySelector("#suppliers_list");
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
      else location.hash = "suppliers_list";
    });
  } catch {}
}

async function waitSuppliersLoadedOrEmpty(page, maxMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    const visibleRows = await page.locator("tr.flag-row-seller:visible").count();
    if (visibleRows > 0) return "rows";

    const emptyText = page.locator(
      "text=/sin proveedores|no se encontraron|no hay proveedores/i"
    );
    if (await emptyText.count()) return "empty";

    await page.waitForTimeout(250);
  }
  return "timeout";
}

async function getMinForRegion(page, regionId) {
  try {
    await page.waitForSelector("#attribute2276", { timeout: 15000 });
    await page.selectOption("#attribute2276", regionId);

    await page.waitForTimeout(350);

    await openSuppliers(page);

    const state = await waitSuppliersLoadedOrEmpty(page, 9000);
    if (state !== "rows") return null;

    const prices = await page.$$eval("tr.flag-row-seller", (rows) => {
      const out = [];
      for (const r of rows) {
        const style = window.getComputedStyle(r);
        const visible =
          style && style.display !== "none" && style.visibility !== "hidden";
        if (!visible) continue;

        const cell = r.querySelector("td.wk-ap-price[data-base]");
        if (!cell) continue;

        const base = Number(cell.getAttribute("data-base"));
        if (Number.isFinite(base) && base > 0) out.push(base);
      }
      return out;
    });

    if (!prices.length) return null;
    return Math.min(...prices);
  } catch {
    return null;
  }
}

// ---------- Click robusto al primer producto ----------
async function clickFirstProduct(page) {
  const candidates = [
    'a:has-text("Ver Producto")',
    'a:has-text("Ver producto")',
    'a:has-text("Ver detalle")',
    'a:has-text("Detalle")',
    'a[href*="/producto"]',
    'a[href*="producto"]',
  ];

  const start = Date.now();
  const maxMs = 30000;

  while (Date.now() - start < maxMs) {
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      const count = await loc.count();
      if (count > 0) {
        try {
          await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
        } catch {}
        try {
          await loc.click({ timeout: 4000, force: true });
          return true;
        } catch {}
      }
    }
    await page.waitForTimeout(250);
  }

  return false;
}

async function scrapeProduct(query) {
  const chromium = getChromium();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  try {
    await page.goto(SEARCH_URL, { timeout: 60000, waitUntil: "networkidle" });

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="Busca"], input[placeholder*="buscar"], input[aria-label*="Buscar"], input[aria-label*="buscar"]'
    );
    await searchInput.waitFor({ timeout: 20000 });
    await searchInput.fill(String(query));
    await searchInput.press("Enter");

    const ok = await clickFirstProduct(page);
    if (!ok) {
      const url = page.url();
      throw new Error(
        `No pude encontrar link al producto tras buscar "${query}". URL actual: ${url}`
      );
    }

    await page.waitForSelector("h1.page-title", { timeout: 30000 });
    const title = (await page.locator("h1.page-title").first().innerText()).trim();

    const result = {
      id: String(query),
      nombre: title,
      moneda: "CLP",
      fuente: "mercadopublico",
    };

    for (const [regionName, regionId] of Object.entries(REGIONES)) {
      const min = await getMinForRegion(page, regionId);
      result[regionName] = min ?? null;
    }

    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { scrapeProduct };