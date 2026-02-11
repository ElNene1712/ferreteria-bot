const { chromium } = require('playwright');
const fs = require('fs');

const SEARCH_URL =
  'https://conveniomarco2.mercadopublico.cl/ferreteria2/productos-de-ferreteria';

const REGIONES = {
  RM: '13',
  VALPO: '5',
  OHIGGINS: '6',
};

// helper: saca solo números de "$1.305" -> 1305 (por si lo necesitamos)
function parseCLP(str) {
  if (!str) return null;
  const n = Number(String(str).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function openSuppliers(page) {
  // a veces el botón existe pero no está visible “en pantalla”
  const btn = page.locator('#go-suppliers-btn');
  if (await btn.count()) {
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 1500 });
    } catch {}
    try {
      await btn.click({ timeout: 4000, force: true });
    } catch {
      // si el click falla, igual intentamos ir directo al anchor
    }
  }

  // Ir directo al anchor ayuda a que quede en viewport la tabla
  try {
    await page.evaluate(() => {
      const el = document.querySelector('#suppliers_list');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      else location.hash = 'suppliers_list';
    });
  } catch {}
}

async function waitSuppliersLoadedOrEmpty(page, maxMs = 8000) {
  // Espera a que:
  // - haya al menos 1 fila visible con precio real
  // - o aparezca algún mensaje de "sin proveedores"/empty state
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    // 1) ¿hay filas visibles?
    const visibleRows = await page.locator('tr.flag-row-seller:visible').count();
    if (visibleRows > 0) return 'rows';

    // 2) ¿hay algún texto que indique vacío?
    const emptyText = page.locator('text=/sin proveedores|no se encontraron|no hay proveedores/i');
    if (await emptyText.count()) return 'empty';

    await page.waitForTimeout(250);
  }
  return 'timeout';
}

async function getMinForRegion(page, regionId) {
  try {
    // Seleccionar región (esto dispara recarga AJAX de precios/proveedores)
    await page.waitForSelector('#attribute2276', { timeout: 15000 });
    await page.selectOption('#attribute2276', regionId);

    // Pequeña pausa para que parta el AJAX
    await page.waitForTimeout(350);

    // Abrir proveedores y esperar carga real
    await openSuppliers(page);

    const state = await waitSuppliersLoadedOrEmpty(page, 9000);
    if (state !== 'rows') return null;

    // Extraer SOLO filas visibles y precios reales (>0)
    const prices = await page.$$eval(
      'tr.flag-row-seller',
      (rows) => {
        const out = [];
        for (const r of rows) {
          const style = window.getComputedStyle(r);
          const visible = style && style.display !== 'none' && style.visibility !== 'hidden';
          if (!visible) continue;

          const cell = r.querySelector('td.wk-ap-price[data-base]');
          if (!cell) continue;

          const base = Number(cell.getAttribute('data-base'));
          if (Number.isFinite(base) && base > 0) out.push(base);
        }
        return out;
      }
    );

    if (!prices.length) return null;
    return Math.min(...prices);
  } catch {
    return null;
  }
}

(async () => {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.log('❌ Debes pasar un ID o nombre');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log(`🔎 Buscando: ${query}`);
  await page.goto(SEARCH_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });

  // Buscar por ID/nombre
  const searchInput = page.locator('input[type="search"], input[placeholder*="Busca"]');
  await searchInput.waitFor({ timeout: 20000 });
  await searchInput.fill(query);
  await searchInput.press('Enter');

  // Entrar al primer resultado
  await page.waitForSelector('a:has-text("Ver Producto")', { timeout: 25000 });
  await page.locator('a:has-text("Ver Producto")').first().click();

  // Esperar título real del producto
  await page.waitForSelector('h1.page-title', { timeout: 30000 });
  const title = (await page.locator('h1.page-title').first().innerText()).trim();
  console.log(`📦 Producto: ${title}`);

  const result = { query, title };

  for (const [regionName, regionId] of Object.entries(REGIONES)) {
    const min = await getMinForRegion(page, regionId);
    result[regionName] = min ?? 'no se encontró';
    console.log(`Región ${regionName}: ${result[regionName]}`);
  }

  fs.writeFileSync('prices.result.json', JSON.stringify(result, null, 2));
  console.log('💾 Guardado: prices.result.json');

  await browser.close();
})();
