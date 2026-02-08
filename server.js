import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Mensaje vacío" });

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: message,
      instructions:
        "Eres ELARA, asistente femenina para gestionar ciclos de remesas. Responde en español, claro y profesional."
    });

    res.json({ reply: response.output_text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fallo en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on", port));
