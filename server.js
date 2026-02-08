import express from "express";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =========================
   PERSISTENCIA (data.json)
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
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveData(data) {
  data.meta.updated_at = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/* =========================
   HELPERS / REGLAS
   ========================= */
function toNumber(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  // admite "5,75" etc
  const s = String(x).trim().replace(/\s+/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

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
  if (cupLibres !== null) {
    cycle.cup_pendientes = round2(cupLibres - cupLiberados);
  } else {
    cycle.cup_pendientes = null;
  }

  const invertido = toNumber(cycle.invertido_rub);
  if (invertido !== null) {
    cycle.ganancia_rub = round2(rubRecibidos - invertido);
    cycle.porcentaje = invertido !== 0 ? round2((cycle.ganancia_rub / invertido) * 100) : null;
  } else {
    cycle.ganancia_rub = null;
    cycle.porcentaje = null;
  }

  // Estado
  if (cycle.cup_pendientes === null) {
    cycle.estado = "Pendiente";
  } else if (cycle.cup_pendientes <= 0) {
    cycle.estado = "Cerrado";
  } else {
    cycle.estado = "En Progreso";
  }

  // Alertas básicas
  const alerts = [];
  if (cycle.cup_pendientes !== null && cycle.cup_pendientes < -1) {
    alerts.push("CUP pendientes negativo: revisa cup_libres o liberaciones.");
  }
  if (invertido !== null && rubRecibidos !== 0 && cycle.ganancia_rub !== null && cycle.ganancia_rub < -1) {
    alerts.push("Ganancia negativa: revisa rub_recibidos o invertido_rub.");
  }
  cycle.alertas = alerts;

  return { ok: true, cycle, liberaciones: libs };
}

/* =========================
   “TOOLS” (ACCIONES)
   ========================= */
function listCycles(data) {
  const arr = Object.values(data.cycles).sort((a, b) => (a.ciclo || 0) - (b.ciclo || 0));
  return arr;
}

function getCycleDetail(data, ciclo) {
  const id = String(ciclo);
  const res = calcCycleDerived(data, id);
  if (!res.ok) return res;
  return res;
}

function createCycle(data, payload) {
  const id = String(payload.ciclo);
  if (!id || id === "undefined") return { ok: false, error: "ciclo inválido" };

  if (data.cycles[id]) {
    return { ok: false, error: `El ciclo ${id} ya existe.` };
  }

  // Campos permitidos (según tu Excel)
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

  data.cycles[id] = cycle;

  const recalced = calcCycleDerived(data, id);
  data.cycles[id].updated_at = new Date().toISOString();

  return { ok: true, cycle: recalced.ok ? recalced.cycle : cycle };
}

function addLiberacion(data, payload) {
  const id = String(payload.ciclo);
  if (!data.cycles[id]) return { ok: false, error: `No existe el ciclo ${id}` };

  const cup = toNumber(payload.cup_liberados);
  const tasa = toNumber(payload.tasa_rub_cup);
  let rub = toNumber(payload.rub_recibidos);

  if (cup === null) return { ok: false, error: "Falta cup_liberados" };

  // Si rub no viene y hay tasa, lo estimamos (solo como cálculo, no “hecho”)
  // Igual lo guardamos como número para que el ciclo sume; tú puedes corregir luego.
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
    "cup_libres"
  ];

  for (const k of allowed) {
    if (payload[k] !== undefined) cycle[k] = toNumber(payload[k]);
  }

  cycle.updated_at = new Date().toISOString();
  const recalced = calcCycleDerived(data, id);

  return { ok: true, cycle: recalced.ok ? recalced.cycle : cycle };
}

/* =========================
   ELARA: PROMPT / OUTPUT JSON
   ========================= */
const SYSTEM_RULES = `
Eres ELARA, asistente femenina premium para gestionar ciclos de remesas (RUB↔CUP) con:
- Ciclos (resumen)
- Liberaciones (movimientos)

ESTILO:
- Español humano, claro y profesional.
- Prohibido mostrar nombres internos (cup_libres, tasa_rub_cup, etc). Usa: "CUP disponibles", "Precio USDT/RUB", "Comisión USDT", "Precio USD/CUP", "Comisión CUP", etc.
- No inventes números. Si falta algo, pregunta 1 cosa concreta y espera.
- Siempre termina tu texto con: "Próximo paso: ..."

MODO 2 (ASISTENTE GUIADO PARA CREAR CICLO):
- Si el usuario dice "crear ciclo", "nuevo ciclo", "abrir ciclo", "iniciar ciclo", activa el modo guiado.
- En modo guiado, SIEMPRE pides SOLO 1 dato por mensaje, en este orden:
  1) Número de ciclo
  2) RUB invertidos
  3) Precio USDT/RUB
  4) Comisión USDT
  5) USDT comprados
  6) Precio USD/CUP
  7) Comisión CUP
- Si el usuario ya dio algunos valores en mensajes anteriores, NO los repitas: pide solo el siguiente que falta.
- Cuando ya tengas los 7 datos, ejecuta la acción create_cycle con esos valores.

CÁLCULOS (internos):
- CUP liberados = suma de liberaciones del ciclo
- RUB recibidos = suma de liberaciones del ciclo
- CUP pendientes = CUP disponibles - CUP liberados
- Ganancia (RUB) = RUB recibidos - RUB invertidos
- % = ganancia / invertido * 100

FORMATO OBLIGATORIO (JSON válido):
{
  "say": "mensaje humano para el usuario (sin variables internas).",
  "actions": [
    { "type": "create_cycle", "data": {...} },
    { "type": "update_cycle", "data": {...} },
    { "type": "add_liberacion", "data": {...} },
    { "type": "get_cycle", "data": {"ciclo": 1} },
    { "type": "list_cycles", "data": {} }
  ]
}
- actions puede ser [].
`.trim();

/* =========================
   ENDPOINTS
   ========================= */
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/cycles", (req, res) => {
  try {
    const data = loadData();
    // recalcula todos por si acaso
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

app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!message) return res.status(400).json({ error: "Mensaje vacío" });

    // Cargamos data actual para que ELARA no hable ciega
    const data = loadData();

    // Contexto compacto de ciclos para no gastar tokens
    const cyclesCompact = listCycles(data).slice(-15).map((c) => ({
      ciclo: c.ciclo,
      estado: c.estado,
      invertido_rub: c.invertido_rub,
      cup_libres: c.cup_libres,
      cup_liberados: c.cup_liberados,
      cup_pendientes: c.cup_pendientes,
      rub_recibidos: c.rub_recibidos,
      ganancia_rub: c.ganancia_rub,
      porcentaje: c.porcentaje
    }));

    const input = [
      ...history.slice(-12),
      {
        role: "user",
        content:
          `Mensaje del usuario: ${message}\n\n` +
          `Ciclos (resumen últimos): ${JSON.stringify(cyclesCompact)}\n` +
          `Nota: Si necesitas operar, devuélveme acciones en JSON.`
      }
    ];

    const ai = await client.responses.create({
      model: "gpt-5-mini",
      instructions: SYSTEM_RULES,
      input
    });

    const raw = (ai.output_text || "").trim();

    // Parse estricto de JSON (con fallback)
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // fallback si la IA te responde con texto suelto: no ejecutamos nada
      parsed = {
        say: raw || "No pude interpretar la respuesta. Próximo paso: repite con más detalle.",
        actions: []
      };
    }

    // Ejecutar acciones
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const results = [];

    for (const act of actions) {
      const type = act?.type;
      const d = act?.data || {};

      if (type === "create_cycle") results.push({ type, result: createCycle(data, d) });
      else if (type === "update_cycle") results.push({ type, result: updateCycle(data, d) });
      else if (type === "add_liberacion") results.push({ type, result: addLiberacion(data, d) });
      else if (type === "get_cycle") results.push({ type, result: getCycleDetail(data, d.ciclo) });
      else if (type === "list_cycles") results.push({ type, result: { ok: true, cycles: listCycles(data) } });
      else results.push({ type, result: { ok: false, error: "Acción no soportada" } });
    }

    // Guardar data (si hubo cambios)
    saveData(data);

    // Si hubo acciones, añadimos un resumen técnico (corto) al usuario
    let extra = "";
    if (results.length) {
      const okCount = results.filter((r) => r.result?.ok).length;
      const badCount = results.length - okCount;
      extra =
        `\n\n(Ejecución: ${okCount} OK${badCount ? `, ${badCount} con error` : ""}.)`;
    }

    const reply = `${parsed.say || "Listo."}${extra}`.trim();

    // actualizar history para el front
    const newHistory = [
      ...history.slice(-12),
      { role: "user", content: message },
      { role: "assistant", content: reply }
    ];

    res.json({ reply, history: newHistory, results });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    res.status(500).json({ error: "Error en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on", port));
