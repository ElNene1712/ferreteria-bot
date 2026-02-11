const { chromium } = require('playwright');
const fs = require('fs');

const SEARCH_URL =
  'https://conveniomarco2.mercadopublico.cl/ferreteria2/productos-de-ferreteria';

const REGIONES = { RM: '13', VALPO: '5', OHIGGINS: '6' };

async function openSuppliers(page) {
  const btn = page.locator('#go-suppliers-btn');
  if (await btn.count()) {
    try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
    try { await btn.click({ timeout: 4000, force: true }); } catch {}
  }
  try {
    await page.evaluate(() => {
      const el = document.querySelector('#suppliers_list');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      else location.hash = 'suppliers_list';
    });
  } catch {}
}

async function waitSuppliersLoadedOrEmpty(page, maxMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const visibleRows = await page.locator('tr.flag-row-seller:visible').count();
    if (visibleRows > 0) return 'rows';

    const emptyText = page.locator('text=/sin proveedores|no se encontraron|no hay proveedores|sin resultados|no hay resultados/i');
    if (await emptyText.count()) return 'empty';

    await page.waitForTimeout(250);
  }
  return 'timeout';
}

async function getMinForRegion(page, regionId) {
  try {
    await page.waitForSelector('#attribute2276', { timeout: 20000 });
    await page.selectOption('#attribute2276', regionId);
    await page.waitForTimeout(400);

    await openSuppliers(page);

    const state = await waitSuppliersLoadedOrEmpty(page, 12000);
    if (state !== 'rows') return null;

    const prices = await page.$$eval('tr.flag-row-seller', (rows) => {
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
    });

    return prices.length ? Math.min(...prices) : null;
  } catch {
    return null;
  }
}

async function fetchOne(browser, query) {
  const page = await browser.newPage();
  const out = {
    ts: new Date().toISOString(),
    id: query,
    title: '',
    RM: '',
    VALPO: '',
    OHIGGINS: '',
    ok: '0',
    error: '',
  };

  // Log de posibles bloqueos
  page.on('response', (res) => {
    const s = res.status();
    if (s === 403 || s === 429 || s === 503) {
      console.log('?? Posible bloqueo:', s, res.url());
    }
  });

  try {
    await page.goto(SEARCH_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });

    const searchInput = page.locator('input[type="search"], input[placeholder*="Busca"]');
    await searchInput.waitFor({ timeout: 25000 });
    await searchInput.fill(query);
    await searchInput.press('Enter');

    // Esperar carga de red (cuando est  ca¡do, aqu¡ suele fallar)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);

    const noResults = page.locator('text=/sin resultados|no se encontraron|no hay resultados/i');
    if (await noResults.count()) {
      out.error = 'Sin resultados en buscador';
      await page.screenshot({ path: `no_results_${query}.png`, fullPage: true });
      return out;
    }

    const verProducto = page.locator('a:has-text("Ver Producto"), button:has-text("Ver Producto")').first();
    try {
      await verProducto.waitFor({ state: 'visible', timeout: 60000 });
      await verProducto.click();
    } catch (e) {
      out.error = 'No apareci¢ "Ver Producto" (timeout).';
      await page.screenshot({ path: `timeout_ver_producto_${query}.png`, fullPage: true });
      fs.writeFileSync(`timeout_ver_producto_${query}.html`, await page.content());
      return out;
    }

    await page.waitForSelector('h1.page-title', { timeout: 40000 });
    out.title = (await page.locator('h1.page-title').first().innerText()).trim();

    for (const [name, id] of Object.entries(REGIONES)) {
      const v = await getMinForRegion(page, id);
      out[name] = v == null ? '' : String(v);
    }

    out.ok = '1';
    return out;
  } catch (e) {
    out.error = String(e?.message || e);
    await page.screenshot({ path: `fail_${query}.png`, fullPage: true }).catch(() => {});
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

function csvLine(o) {
  const vals = [o.ts, o.id, o.title, o.RM, o.VALPO, o.OHIGGINS, o.ok, o.error];
  return vals.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';');
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.log('Uso: node prices-batch.js ids.txt');
    process.exit(1);
  }

  const ids = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const outName = `prices_${new Date().toISOString().slice(0,10)}.csv`;
  fs.writeFileSync(outName, 'ts;id;title;RM;VALPO;OHIGGINS;ok;error\n');

  const browser = await chromium.launch({ headless: true });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    console.log(`(${i+1}/${ids.length}) ${id}`);

    let r = await fetchOne(browser, id);
    if (r.ok !== '1') {
      // retry suave
      await new Promise(res => setTimeout(res, 1200));
      r = await fetchOne(browser, id);
    }

    fs.appendFileSync(outName, csvLine(r) + '\n');
    console.log(`  -> ${r.ok === '1' ? 'OK' : 'FAIL'} | RM=${r.RM} VALPO=${r.VALPO} OH=${r.OHIGGINS}`);

    // pausa anti-rate-limit
    await new Promise(res => setTimeout(res, 800 + Math.floor(Math.random() * 900)));
  }

  await browser.close();
  console.log(`Listo: ${outName}`);
})();
