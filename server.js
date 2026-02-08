const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Servir estáticos
app.use(express.static(path.join(__dirname, "public")));

// Health check (por si Render lo necesita)
app.get("/health", (req, res) => res.json({ ok: true, name: "ELARA" }));

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ELARA UI running on port ${PORT}`);
});
