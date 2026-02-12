const { chromium } = require("playwright");

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

async function scrapeProduct(query) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.goto(SEARCH_URL, { timeout: 60000, waitUntil: "domcontentloaded" });

  // Buscar por ID/nombre
  const searchInput = page.locator('input[type="search"], input[placeholder*="Busca"]');
  await searchInput.waitFor({ timeout: 20000 });
  await searchInput.fill(query);
  await searchInput.press("Enter");

  // Entrar al primer resultado
  await page.waitForSelector('a:has-text("Ver Producto")', { timeout: 25000 });
  await page.locator('a:has-text("Ver Producto")').first().click();

  // Esperar título real del producto
  await page.waitForSelector("h1.page-title", { timeout: 30000 });
  const title = (await page.locator("h1.page-title").first().innerText()).trim();

  const result = { id: query, nombre: title, moneda: "CLP", fuente: "mercadopublico" };

  for (const [regionName, regionId] of Object.entries(REGIONES)) {
    const min = await getMinForRegion(page, regionId);
    result[regionName] = min ?? null;
  }

  await browser.close();
  return result;
}

module.exports = { scrapeProduct };
