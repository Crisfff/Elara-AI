import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
          meta: {
            name: "ELARA",
            currency_origin: "RUB",
            currency_target: "CUP",
            updated_at: null,
          },
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
function clampText(s) {
  // Limpia cualquier cosa “tipo comando” o JSON que se cuele
  if (!s) return "";
  let t = String(s).trim();

  // si por error devolvió un JSON completo, intentamos sacar "say"
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const parsed = JSON.parse(t);
      if (parsed?.say) t = String(parsed.say);
    } catch {}
  }

  // quita líneas raras tipo actions/type/data o llaves
  t = t
    .split("\n")
    .filter((line) => {
      const l = line.trim().toLowerCase();
      if (!l) return false;
      if (l.includes('"actions"') || l.includes('"type"') || l.includes('"data"')) return false;
      if (l.startsWith("{") || l.startsWith("}")) return false;
      if (l.startsWith("[") || l.startsWith("]")) return false;
      return true;
    })
    .join("\n")
    .trim();

  // Limita a respuestas cortas (no párrafos)
  const lines = t.split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length > 5) t = lines.slice(0, 5).join("\n");
  if (t.length > 450) t = t.slice(0, 450).trim();

  return t;
}

/* =========================
   REGLAS (DERIVADOS)
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

  const alerts = [];
  if (cycle.cup_pendientes !== null && cycle.cup_pendientes < -1) alerts.push("Pendientes negativos. Revisa datos.");
  if (invertido !== null && cycle.ganancia_rub !== null && cycle.ganancia_rub < -1) alerts.push("Ganancia negativa. Revisa datos.");
  cycle.alertas = alerts;

  return { ok: true, cycle, liberaciones: libs };
}

/* =========================
   ACTIONS (internas)
   ========================= */
function listCycles(data) {
  return Object.values(data.cycles).sort((a, b) => (a.ciclo || 0) - (b.ciclo || 0));
}
function getCycleDetail(data, ciclo) {
  return calcCycleDerived(data, String(ciclo));
}

function createCycle(data, payload) {
  const id = String(payload.ciclo);
  if (!id || id === "undefined") return { ok: false, error: "Ciclo inválido" };
  if (data.cycles[id]) return { ok: false, error: `El ciclo ${id} ya existe` };

  // Campos obligatorios del ciclo completo (tu Excel)
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
    alertas: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Si hay CUP bruto y comisión CUP, calcula CUP disponibles
  if (cycle.cup_libres === null && cycle.cup_bruto !== null && cycle.comision_cup !== null) {
    cycle.cup_libres = round2(cycle.cup_bruto - cycle.comision_cup);
  }

  data.cycles[id] = cycle;
  const recalced = calcCycleDerived(data, id);
  data.cycles[id].updated_at = new Date().toISOString();
  return { ok: true, cycle: recalced.ok ? recalced.cycle : cycle };
}

function updateCycle(data, payload) {
  const id = String(payload.ciclo);
  const cycle = data.cycles[id];
  if (!cycle) return { ok: false, error: `No existe el ciclo ${id}` };

  const allowed = [
    "invertido_rub",
    "precio_usd_rub",
    "comision_usdt",
    "usdt_comprados",
    "precio_usd_cup",
    "cup_bruto",
    "comision_cup",
    "cup_libres",
  ];

  for (const k of allowed) {
    if (payload[k] !== undefined) cycle[k] = toNumber(payload[k]);
  }

  if (cycle.cup_libres === null && cycle.cup_bruto !== null && cycle.comision_cup !== null) {
    cycle.cup_libres = round2(cycle.cup_bruto - cycle.comision_cup);
  }

  cycle.updated_at = new Date().toISOString();
  const recalced = calcCycleDerived(data, id);
  return { ok: true, cycle: recalced.ok ? recalced.cycle : cycle };
}

function addLiberacion(data, payload) {
  const id = String(payload.ciclo);
  if (!data.cycles[id]) return { ok: false, error: `No existe el ciclo ${id}` };

  const cup = toNumber(payload.cup_liberados);
  const tasa = toNumber(payload.tasa_rub_cup);
  let rub = toNumber(payload.rub_recibidos);

  if (cup === null) return { ok: false, error: "Falta CUP liberados" };

  if (rub === null && tasa !== null && tasa !== 0) {
    rub = round2(cup / tasa);
  }

  const lib = {
    id: crypto.randomUUID(),
    ciclo: Number(id),
    cup_liberados: cup,
    tasa_rub_cup: tasa,
    rub_recibidos: rub,
    nota: payload.nota ? String(payload.nota) : null,
    created_at: new Date().toISOString(),
  };

  data.liberaciones.push(lib);

  const recalced = calcCycleDerived(data, id);
  data.cycles[id].updated_at = new Date().toISOString();
  return { ok: true, liberacion: lib, cycle: recalced.ok ? recalced.cycle : data.cycles[id] };
}

/* =========================
   WIZARD MODO 2 (crear ciclo)
   ========================= */
const WIZARD = new Map(); // sessionId => {step, draft}

/* =========================
   ELARA PROMPT (corto, amable, directo)
   ========================= */
const SYSTEM_RULES = `
Eres ELARA. Responde SIEMPRE corto: 1 a 3 líneas. Máximo 5 bullets.
Tono: amable, directo, profesional. Cero párrafos.
Prohibido mostrar JSON, comandos o nombres técnicos. No digas "actions", "type", "data".
Si falta un dato: pregunta SOLO 1 cosa y da un ejemplo.
Siempre termina con: "Próximo paso: ...".
`.trim();

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
    const out = getCycleDetail(data, req.params.id);
    if (!out.ok) return res.status(404).json(out);
    saveData(data);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en /api/cycles/:id" });
  }
});

/* =========================
   CHAT
   ========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const sessionId = (req.body?.sessionId || "default").toString();

    if (!message) return res.status(400).json({ error: "Mensaje vacío" });

    if (!WIZARD.has(sessionId)) WIZARD.set(sessionId, { step: 0, draft: {} });
    const wiz = WIZARD.get(sessionId);

    const low = message.toLowerCase();
    const startCycle = /(crear|nuevo|iniciar|abrir)\s+(un\s+)?ciclo/.test(low);
    const cancel = /(cancelar|salir|stop|parar|terminar)/.test(low);

    // Cancelar wizard
    if (cancel && wiz.step > 0) {
      wiz.step = 0;
      wiz.draft = {};
      const reply = "Listo, cancelado.\nPróximo paso: ¿crear ciclo o añadir liberación?";
      const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
      return res.json({ reply, history: newHistory });
    }

    // Iniciar wizard
    if (startCycle && wiz.step === 0) {
      wiz.step = 1;
      wiz.draft = {};
      const reply = "Perfecto.\n¿Qué número de ciclo es? (ej: 6)\nPróximo paso: dime el número.";
      const newHistory = [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }];
      return res.json({ reply, history: newHistory });
    }

    // Wizard activo: 1 dato por turno (corto y amable)
    if (wiz.step > 0) {
      const n = toNumber(message);

      if (wiz.step === 1) {
        if (!n) return res.json({ reply: "Solo el número del ciclo (ej: 6).\nPróximo paso: envíame el número." });
        wiz.draft.ciclo = Math.trunc(n);
        wiz.step = 2;
        return res.json({ reply: `Ciclo ${wiz.draft.ciclo}, perfecto.\n¿Cuántos RUB invertiste? (ej: 11000)\nPróximo paso: dime el invertido.` });
      }

      if (wiz.step === 2) {
        if (n === null) return res.json({ reply: "¿Cuántos RUB invertiste? (ej: 11000)\nPróximo paso: envíame el monto." });
        wiz.draft.invertido_rub = n;
        wiz.step = 3;
        return res.json({ reply: "¿Precio USDT/RUB? (ej: 80)\nPróximo paso: dime el precio." });
      }

      if (wiz.step === 3) {
        if (n === null) return res.json({ reply: "Precio USDT/RUB, porfa (ej: 80).\nPróximo paso: envíame el precio." });
        wiz.draft.precio_usd_rub = n;
        wiz.step = 4;
        return res.json({ reply: "¿Comisión en USDT? (ej: 0,99)\nPróximo paso: dime la comisión." });
      }

      if (wiz.step === 4) {
        if (n === null) return res.json({ reply: "Comisión USDT (ej: 0,99).\nPróximo paso: envíame la comisión." });
        wiz.draft.comision_usdt = n;
        wiz.step = 5;
        return res.json({ reply: "¿USDT comprados?\nSi no sabes, escribe: “calcula tú”.\nPróximo paso: dime los USDT." });
      }

      if (wiz.step === 5) {
        if (/calcula|estima|hazlo tu|tu calcula/i.test(message)) {
          const inv = toNumber(wiz.draft.invertido_rub);
          const px = toNumber(wiz.draft.precio_usd_rub);
          const fee = toNumber(wiz.draft.comision_usdt) || 0;
          if (inv !== null && px && px !== 0) {
            wiz.draft.usdt_comprados = round2(inv / px - fee);
            wiz.step = 6;
            return res.json({ reply: `Ok, estimo ~${wiz.draft.usdt_comprados} USDT.\n¿Precio USD/CUP? (ej: 562)\nPróximo paso: dime el USD/CUP.` });
          }
          return res.json({ reply: "Me falta invertido o precio USDT/RUB.\nPróximo paso: dime el dato que falta." });
        }

        const nn = toNumber(message);
        if (nn === null) return res.json({ reply: "USDT comprados (ej: 136,51) o “calcula tú”.\nPróximo paso: envíame eso." });
        wiz.draft.usdt_comprados = nn;
        wiz.step = 6;
        return res.json({ reply: "Perfecto.\n¿Precio USD/CUP? (ej: 562)\nPróximo paso: dime el USD/CUP." });
      }

      if (wiz.step === 6) {
        if (n === null) return res.json({ reply: "Precio USD/CUP (ej: 562).\nPróximo paso: envíame el precio." });
        wiz.draft.precio_usd_cup = n;
        wiz.step = 7;
        return res.json({ reply: "¿Comisión en CUP? (ej: 2301,56)\nPróximo paso: dime la comisión CUP." });
      }

      if (wiz.step === 7) {
        if (n === null) return res.json({ reply: "Comisión CUP (ej: 2301,56).\nPróximo paso: envíame la comisión." });
        wiz.draft.comision_cup = n;

        const data = loadData();
        const created = createCycle(data, {
          ciclo: wiz.draft.ciclo,
          invertido_rub: wiz.draft.invertido_rub,
          precio_usd_rub: wiz.draft.precio_usd_rub,
          comision_usdt: wiz.draft.comision_usdt,
          usdt_comprados: wiz.draft.usdt_comprados,
          precio_usd_cup: wiz.draft.precio_usd_cup,
          comision_cup: wiz.draft.comision_cup,
        });
        saveData(data);

        wiz.step = 0;
        wiz.draft = {};

        if (!created.ok) {
          return res.json({ reply: `No pude crear el ciclo: ${created.error}.\nPróximo paso: dime qué dato corriges.` });
        }

        return res.json({ reply: `Listo ✅ Ciclo ${created.cycle.ciclo} creado.\nPróximo paso: ¿añadimos una liberación?` });
      }
    }

    /* =========================
       MODO NORMAL (IA)
       - Responde corto y amable
       - NO muestra comandos
       ========================= */
    const data = loadData();
    for (const id of Object.keys(data.cycles)) calcCycleDerived(data, id);
    saveData(data);

    const cyclesCompact = listCycles(data).slice(-12).map((c) => ({
      ciclo: c.ciclo,
      estado: c.estado,
      rub_invertidos: c.invertido_rub,
      cup_disponibles: c.cup_libres,
      cup_liberados: c.cup_liberados,
      cup_pendientes: c.cup_pendientes,
      rub_recibidos: c.rub_recibidos,
      ganancia_rub: c.ganancia_rub,
      porcentaje: c.porcentaje,
    }));

    const input = [
      ...history.slice(-10),
      {
        role: "user",
        content:
          `Usuario: ${message}\n` +
          `Ciclos resumen: ${JSON.stringify(cyclesCompact)}\n` +
          `Responde corto, sin tecnicismos. Si falta info, pregunta 1 cosa.`,
      },
    ];

    const ai = await client.responses.create({
      model: "gpt-5-mini",
      instructions: SYSTEM_RULES,
      input,
      // Mantiene cortito
      max_output_tokens: 200,
    });

    let reply = clampText(ai.output_text || "");
    if (!reply) reply = "Entendido.\nPróximo paso: dime qué quieres hacer (crear ciclo / liberar CUP / ver estado).";
    if (!/Próximo paso:/i.test(reply)) reply = `${reply}\nPróximo paso: dime qué quieres hacer.`;

    const newHistory = [
      ...history.slice(-12),
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ];

    res.json({ reply, history: newHistory });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    res.status(500).json({ error: "Error en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on", port));
