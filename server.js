import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/* =========================
   DATA (data.json)
   ========================= */
const DATA_PATH = path.resolve(process.cwd(), "data.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify(
        {
          meta: { name: "ELARA", updated_at: null },
          cycles: {},
          liberaciones: [],
        },
        null,
        2
      ),
      "utf-8"
    );
  }
}
function loadData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}
function saveData(data) {
  data.meta.updated_at = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/* =========================
   HELPERS
   ========================= */
function toNumber(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const s = String(x).trim().replace(/\s+/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function round2(n) {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}
function oneLine(s) {
  if (!s) return "";
  let t = String(s).trim();
  // Si por error devuelve JSON, intentamos sacar campo say
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const j = JSON.parse(t);
      if (j?.say) t = String(j.say);
    } catch {}
  }
  // quita saltos y deja 1 línea
  t = t.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // evita parrafadas
  if (t.length > 220) t = t.slice(0, 220).trim();
  return t;
}

function percentFromText(msg) {
  const m = String(msg).replace(",", ".").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const p = Number(m[1]);
  return Number.isFinite(p) ? p : null;
}

/* =========================
   CÁLCULOS CICLO (DERIVADOS)
   ========================= */
function calcCycleDerived(data, cycleId) {
  const id = String(cycleId);
  const cycle = data.cycles[id];
  if (!cycle) return { ok: false, error: `No existe el ciclo ${id}` };

  const libs = data.liberaciones.filter((l) => String(l.ciclo) === id);

  const cupLiberados = libs.reduce((acc, l) => acc + (toNumber(l.cup_liberados) || 0), 0);
  const rubRecibidos = libs.reduce((acc, l) => acc + (toNumber(l.rub_recibidos) || 0), 0);

  cycle.cup_liberados = round2(cupLiberados);
  cycle.rub_recibidos = round2(rubRecibidos);

  const cupLibres = toNumber(cycle.cup_libres);
  cycle.cup_pendientes = cupLibres !== null ? round2(cupLibres - cupLiberados) : null;

  const invertido = toNumber(cycle.invertido_rub);
  if (invertido !== null) {
    cycle.ganancia_rub = round2(rubRecibidos - invertido);
    cycle.porcentaje = invertido !== 0 ? round2((cycle.ganancia_rub / invertido) * 100) : null;
  } else {
    cycle.ganancia_rub = null;
    cycle.porcentaje = null;
  }

  if (cycle.cup_pendientes === null) cycle.estado = "Pendiente";
  else if (cycle.cup_pendientes <= 0) cycle.estado = "Cerrado";
  else cycle.estado = "En Progreso";

  return { ok: true, cycle, liberaciones: libs };
}

/* =========================
   CRUD / ACTIONS
   ========================= */
function listCycles(data) {
  return Object.values(data.cycles).sort((a, b) => (a.ciclo || 0) - (b.ciclo || 0));
}

function createCycle(data, payload) {
  const id = String(payload.ciclo);
  if (!id || id === "undefined") return { ok: false, error: "Ciclo inválido" };
  if (data.cycles[id]) return { ok: false, error: `El ciclo ${id} ya existe` };

  const required = [
    "ciclo",
    "invertido_rub",
    "precio_usd_rub",
    "comision_usdt",
    "usdt_comprados",
    "precio_usd_cup",
    "comision_cup",
  ];
  for (const k of required) {
    if (payload[k] === undefined || payload[k] === null || payload[k] === "") {
      return { ok: false, error: `Falta dato: ${k}` };
    }
  }

  const cycle = {
    ciclo: Number(id),
    invertido_rub: toNumber(payload.invertido_rub),
    precio_usd_rub: toNumber(payload.precio_usd_rub),
    comision_usdt: toNumber(payload.comision_usdt),
    usdt_comprados: toNumber(payload.usdt_comprados),
    precio_usd_cup: toNumber(payload.precio_usd_cup),

    cup_bruto: toNumber(payload.cup_bruto),
    comision_cup: toNumber(payload.comision_cup),
    cup_libres: toNumber(payload.cup_libres),

    cup_liberados: 0,
    cup_pendientes: null,
    rub_recibidos: 0,
    ganancia_rub: null,
    porcentaje: null,
    estado: "Pendiente",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Calcula CUP disponibles si hay cup_bruto y comision_cup
  if (cycle.cup_libres === null && cycle.cup_bruto !== null && cycle.comision_cup !== null) {
    cycle.cup_libres = round2(cycle.cup_bruto - cycle.comision_cup);
  }

  data.cycles[id] = cycle;
  const recalced = calcCycleDerived(data, id);
  data.cycles[id].updated_at = new Date().toISOString();
  return { ok: true, cycle: recalced.ok ? recalced.cycle : cycle };
}

/* =========================
   ELARA “VOZ” (IA SOLO PARA FRASES)
   ========================= */
const ELARA_STYLE = `
Eres ELARA. Hablas en español, directo, amable, profesional.
Reglas estrictas:
- Responde SIEMPRE en 1 sola línea (sin saltos).
- No uses “Próximo paso:”.
- No uses paréntesis con ejemplos.
- No menciones JSON, comandos, variables, ni nombres técnicos.
- Haz 1 sola pregunta cuando falte un dato.
- Si confirmas algo, que sea breve (máx 12 palabras) y pregunta lo siguiente.
`.trim();

async function elaraLine({ intent, have, need, userText, note }) {
  // Fallback si no hay API
  if (!client) {
    const map = {
      start: "Perfecto. ¿Qué número de ciclo es?",
      ciclo: "¿Qué número de ciclo es?",
      invertido_rub: "¿Cuántos RUB invertiste?",
      precio_usd_rub: "¿A cuánto compraste el USDT en RUB?",
      comision_usdt: "¿Qué comisión te cobraron en USDT?",
      usdt_comprados: "¿Cuántos USDT compraste? Puedes decir “calcula tú”.",
      precio_usd_cup: "¿A cuánto está el USD/CUP?",
      comision_cup: "¿Cuál fue la comisión en CUP? Puedes decir un porcentaje.",
      done: "Listo, ciclo creado. ¿Quieres añadir una liberación ahora?",
    };
    return map[need] || "Dime ese dato, porfa.";
  }

  const prompt =
    `Contexto: estás guiando la creación de un ciclo.\n` +
    `Usuario dijo: "${userText}"\n` +
    `Ya tengo: ${JSON.stringify(have)}\n` +
    `Me falta: ${need}\n` +
    (note ? `Nota interna: ${note}\n` : "") +
    `Genera una sola línea: confirma corto (si aplica) y pregunta SOLO por "${need}".`;

  const r = await client.responses.create({
    model: "gpt-5-mini",
    instructions: ELARA_STYLE,
    input: prompt,
    max_output_tokens: 120,
  });

  return oneLine(r.output_text || "");
}

/* =========================
   WIZARD (SERVER CONTROLA PASOS)
   ========================= */
const WIZARD = new Map(); // sessionId => { step, draft }

const STEPS = [
  "ciclo",
  "invertido_rub",
  "precio_usd_rub",
  "comision_usdt",
  "usdt_comprados",
  "precio_usd_cup",
  "comision_cup",
];

function nextNeed(stepIndex) {
  return STEPS[stepIndex] || "done";
}

/* =========================
   ENDPOINTS
   ========================= */
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/cycles", (req, res) => {
  try {
    const data = loadData();
    for (const id of Object.keys(data.cycles)) calcCycleDerived(data, id);
    saveData(data);
    res.json({ cycles: listCycles(data) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en /api/cycles" });
  }
});

app.get("/api/cycles/:id", (req, res) => {
  try {
    const data = loadData();
    const out = calcCycleDerived(data, req.params.id);
    if (!out.ok) return res.status(404).json(out);
    saveData(data);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en /api/cycles/:id" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const sessionId = (req.body?.sessionId || "default").toString();

    if (!message) return res.status(400).json({ error: "Mensaje vacío" });

    if (!WIZARD.has(sessionId)) WIZARD.set(sessionId, { step: -1, draft: {} });
    const wiz = WIZARD.get(sessionId);

    const low = message.toLowerCase();
    const start = /(crear|nuevo|iniciar|abrir)\s+(un\s+)?ciclo/.test(low);
    const cancel = /(cancelar|salir|stop|parar|terminar)/.test(low);

    // cancelar wizard
    if (cancel && wiz.step >= 0) {
      wiz.step = -1;
      wiz.draft = {};
      const reply = "Listo, lo cancelé. ¿Creamos otro ciclo o revisamos uno?";
      const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
      return res.json({ reply, history: newHistory });
    }

    // iniciar wizard
    if (start && wiz.step === -1) {
      wiz.step = 0;
      wiz.draft = {};
      const need = nextNeed(wiz.step);
      const reply = await elaraLine({ intent: "start", have: wiz.draft, need, userText: message });
      const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
      return res.json({ reply, history: newHistory });
    }

    // wizard activo
    if (wiz.step >= 0) {
      const need = nextNeed(wiz.step);
      let note = "";

      // 1) ciclo
      if (need === "ciclo") {
        const n = toNumber(message);
        if (!n) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.ciclo = Math.trunc(n);
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 2) invertido_rub
      if (need === "invertido_rub") {
        const n = toNumber(message);
        if (n === null) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.invertido_rub = n;
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 3) precio_usd_rub
      if (need === "precio_usd_rub") {
        const n = toNumber(message);
        if (n === null || n <= 0) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.precio_usd_rub = n;
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 4) comision_usdt
      if (need === "comision_usdt") {
        const n = toNumber(message);
        if (n === null || n < 0) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.comision_usdt = n;
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 5) usdt_comprados (acepta “calcula tú”)
      if (need === "usdt_comprados") {
        if (/calcula|estima|hazlo tu|tu calcula/i.test(message)) {
          const inv = toNumber(wiz.draft.invertido_rub);
          const px = toNumber(wiz.draft.precio_usd_rub);
          const fee = toNumber(wiz.draft.comision_usdt) || 0;
          if (inv !== null && px && px !== 0) {
            wiz.draft.usdt_comprados = round2(inv / px - fee);
            note = `Calculé USDT aproximados: ${wiz.draft.usdt_comprados}`;
            wiz.step++;
            const reply = await elaraLine({
              intent: "ask",
              have: wiz.draft,
              need: nextNeed(wiz.step),
              userText: message,
              note,
            });
            return res.json({ reply });
          }
          const reply = await elaraLine({
            intent: "ask",
            have: wiz.draft,
            need: "usdt_comprados",
            userText: message,
            note: "No puedo calcular sin invertido y precio USDT/RUB",
          });
          return res.json({ reply });
        }

        const n = toNumber(message);
        if (n === null || n <= 0) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.usdt_comprados = n;
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 6) precio_usd_cup
      if (need === "precio_usd_cup") {
        const n = toNumber(message);
        if (n === null || n <= 0) {
          const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
          return res.json({ reply });
        }
        wiz.draft.precio_usd_cup = n;
        wiz.step++;
        const reply = await elaraLine({ intent: "ask", have: wiz.draft, need: nextNeed(wiz.step), userText: message });
        return res.json({ reply });
      }

      // 7) comision_cup (acepta %)
      if (need === "comision_cup") {
        const p = percentFromText(message);
        if (p !== null) {
          const usdt = toNumber(wiz.draft.usdt_comprados);
          const usdCup = toNumber(wiz.draft.precio_usd_cup);
          if (usdt !== null && usdCup !== null) {
            const cupBruto = round2(usdt * usdCup);
            const comCup = round2(cupBruto * (p / 100));
            wiz.draft.cup_bruto = cupBruto;
            wiz.draft.comision_cup = comCup;
            note = `Tomé ${p}% de CUP comprados. Comisión CUP: ${comCup}`;
          } else {
            const reply = await elaraLine({
              intent: "ask",
              have: wiz.draft,
              need,
              userText: message,
              note: "Para calcular % necesito USDT comprados y USD/CUP",
            });
            return res.json({ reply });
          }
        } else {
          const n = toNumber(message);
          if (n === null || n < 0) {
            const reply = await elaraLine({ intent: "ask", have: wiz.draft, need, userText: message });
            return res.json({ reply });
          }
          wiz.draft.comision_cup = n;
        }

        // Crear ciclo final
        const data = loadData();
        const created = createCycle(data, {
          ciclo: wiz.draft.ciclo,
          invertido_rub: wiz.draft.invertido_rub,
          precio_usd_rub: wiz.draft.precio_usd_rub,
          comision_usdt: wiz.draft.comision_usdt,
          usdt_comprados: wiz.draft.usdt_comprados,
          precio_usd_cup: wiz.draft.precio_usd_cup,
          comision_cup: wiz.draft.comision_cup,
          cup_bruto: wiz.draft.cup_bruto,
        });

        saveData(data);

        // reset wizard
        wiz.step = -1;
        wiz.draft = {};

        if (!created.ok) {
          const reply = oneLine(`No pude crearlo: ${created.error}. ¿Lo intentamos otra vez?`);
          const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
          return res.json({ reply, history: newHistory });
        }

        const reply = await elaraLine({
          intent: "done",
          have: { ciclo: created.cycle.ciclo },
          need: "done",
          userText: message,
          note: note || "Ciclo creado",
        });

        const safeReply = reply || oneLine(`Listo, ciclo ${created.cycle.ciclo} creado. ¿Añadimos una liberación?`);
        const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: safeReply }];
        return res.json({ reply: safeReply, history: newHistory });
      }
    }

    /* =========================
       MODO NORMAL (CHAT CORTO)
       Aquí solo respondemos, sin ejecutar “acciones”.
       (Si luego quieres tools reales aquí también, lo montamos)
       ========================= */
    const data = loadData();
    for (const id of Object.keys(data.cycles)) calcCycleDerived(data, id);
    saveData(data);

    const cyclesCompact = listCycles(data).slice(-10).map((c) => ({
      ciclo: c.ciclo,
      estado: c.estado,
      invertido: c.invertido_rub,
      cup_disponibles: c.cup_libres,
      cup_pendientes: c.cup_pendientes,
      ganancia_rub: c.ganancia_rub,
      porcentaje: c.porcentaje,
    }));

    const fallback = "Dime qué quieres hacer: crear ciclo, ver estado o añadir liberación.";

    if (!client) {
      const reply = fallback;
      const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
      return res.json({ reply, history: newHistory });
    }

    const normalInstructions = `
Eres ELARA. Responde en 1 línea, amable y directa.
No uses párrafos. No uses "Próximo paso".
Si falta info, pregunta 1 cosa.
No menciones JSON, comandos ni variables.
`.trim();

    const input =
      `Usuario: "${message}"\n` +
      `Ciclos: ${JSON.stringify(cyclesCompact)}\n` +
      `Responde breve y útil.`;

    const r = await client.responses.create({
      model: "gpt-5-mini",
      instructions: normalInstructions,
      input,
      max_output_tokens: 140,
    });

    let reply = oneLine(r.output_text || "");
    if (!reply) reply = fallback;

    const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
    return res.json({ reply, history: newHistory });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    res.status(500).json({ error: "Error en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on", port));
