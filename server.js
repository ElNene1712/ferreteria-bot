const express = require("express");
const { scrapeProduct } = require("./prices-by-search");

const app = express();

app.get("/", (req, res) => {
  res
    .status(200)
    .send(
      "OK. Usa /health o /search?q=2144208 (o /search?id=...)."
    );
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// /search?q=2144208  ó  /search?id=2144208
app.get("/search", async (req, res) => {
  const query = String(req.query.id || req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Falta id o q" });

  try {
    const result = await scrapeProduct(query);
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
