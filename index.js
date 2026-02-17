// index.js
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => {
  res.status(200).send("OK. Usa /health o /search?q=2144208 (o /search?id=...).");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// helper: timeout para que /search no quede colgado
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
    // ✅ IMPORTAR AQUÍ, no arriba: así /health funciona aunque Playwright falle
    const { scrapeProduct } = require("./prices-by-search");

    const result = await withTimeout(scrapeProduct(query), 25000);
    return res.status(200).json(result);
  } catch (err) {
    console.error("ERROR /search:", err);
    return res.status(500).json({
      error: "Scrape failed",
      details: String(err?.message || err),
    });
  }
});

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
