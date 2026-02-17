app.use(cors());
app.use(express.json());

// log simple (útil en Railway)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get("/", (req, res) => {
  res
    .status(200)
@@ -17,24 +23,34 @@
  res.json({ ok: true });
});

// helper: timeout para promesas (evita que quede colgado)
function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// /search?q=2144208  ó  /search?id=2144208
app.get("/search", async (req, res) => {
  const query = String(req.query.id || req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Falta id o q" });

  try {
    const result = await scrapeProduct(query);
    const result = await withTimeout(scrapeProduct(query), 25000);
    res.json(result);
  } catch (err) {
    console.error("ERROR /search:", err);
    res.status(500).json({
      error: "Scrape failed",
      details: String(err?.message || err),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});