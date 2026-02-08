import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * POST /api/chat
 * body: { message: string, history?: [{role:"user"|"assistant", content:string}] }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    // Limita historial para costos/latencia (ajustable)
    const clippedHistory = history.slice(-12);

    const instructions = `
Eres ELARA, una asistente femenina premium para gestionar ciclos de remesas.
Habla en español, tono profesional y claro.
Objetivo: ayudar a registrar, consultar y analizar ciclos.
Si falta información, haz 1 pregunta concreta.
No inventes números; si no hay datos, dilo y sugiere qué dato falta.
    `.trim();

    const input = [
      ...clippedHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await client.responses.create({
      model: "gpt-5",
      instructions,
      input,
    });

    return res.json({
      reply: response.output_text,
      // opcional: devuelve un history actualizado para el front
      history: [
        ...clippedHistory,
        { role: "user", content: message },
        { role: "assistant", content: response.output_text },
      ],
    });
  } catch (err) {
    console.error("CHAT ERROR:", err?.message || err);
    return res.status(500).json({ error: "Error en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on port", port));
