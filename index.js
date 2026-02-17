const express = require("express");
const cors = require("cors");
const { scrapeProduct } = require("./prices-by-search");

const app = express();

// Si después quieres cerrar CORS, lo hacemos. Por ahora abierto para debug.
app.use(cors());
app.use(express.json());

// Logs básicos (te ayudan a ver si Railway realmente está recibiendo requests)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => {
  res
    .status(200)
    .send("OK. Usa /health o /search?q=2144208 (o /search?id=...).");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// /search?q=2144208  ó  /search?id=2144208
app.get("/search", async (req, res) => {
  const query = String(req.query.id || req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Falta id o q" });

  try {
    const result = await scrapeProduct(query);
    retu
