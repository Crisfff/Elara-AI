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
   HELPERS / NUMEROS
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

/* =========================
   REGLAS DE CICLO (DERIVADOS)
   ========================= */
function calcCycleDerived(data, cycleId) {
  const id = String(cycleId);
  const cycle = data.cycles[id];
  if (!cycle) return { ok: false, error: `No existe el ciclo ${id}` };

  const libs = data.liberaciones.filter((l) => String(l.ciclo) === id);

  const cupLiberados = libs.reduce(
    (acc, l) => acc + (toNumber(l.cup_liberados) || 0),
    0
  );
  const rubRecibidos = libs.reduce(
    (acc, l) => acc + (toNumber(l.rub_recibidos) || 0),
    0
  );

  cycle.cup_liberados = round2(cupLiberados);
  cycle.rub_recibidos = round2(rubRecibidos);

  const cupLibres = toNumber(cycle.cup_libres);
  cycle.cup_pendientes =
    cupLibres !== null ? round2(cupLibres - cupLiberados) : null;

  const invertido = toNumber(cycle.invertido_rub);
  if (invertido !== null) {
    cycle.ganancia_rub = round2(rubRecibidos - invertido);
    cycle.porcentaje =
      invertido !== 0 ? round2((cycle.ganancia_rub / invertido) * 100) : null;
  } else {
    cycle.ganancia_rub = null;
    cycle.porcentaje = null;
  }

  // Estado
  if (cycle.cup_pendientes === null) cycle.estado = "Pendiente";
  else if (cycle.cup_pendientes <= 0) cycle.estado = "Cerrado";
  else cycle.estado = "En Progreso";

  // Alertas
  const alerts = [];
  if (cycle.cup_pendientes !== null && cycle.cup_pendientes < -1) {
    alerts.push("CUP pendientes negativo: revisa CUP disponibles o liberaciones.");
  }
  if (invertido !== null && cycle.ganancia_rub !== null && cycle.ganancia_rub < -1) {
    alerts.push("Ganancia negativa: revisa RUB recibidos o invertido.");
  }
  cycle.alertas = alerts;

  return { ok: true, cycle, liberaciones: libs };
}

/* =========================
   “TOOLS” (ACCIONES REALES)
   ========================= */
function listCycles(data) {
  return Object.values(data.cycles).sort((a, b) => (a.ciclo || 0) - (b.ciclo || 0));
}

function getCycleDetail(data, ciclo) {
  return calcCycleDerived(data, String(ciclo));
}

function createCycle(data, payload) {
  const id = String(payload.ciclo);
  if (!id || id === "undefined") return { ok: false, error: "ciclo inválido" };
  if (data.cycles[id]) return { ok: false, error: `El ciclo ${id} ya existe.` };

  // Obligatorios para tu ciclo completo
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
      return { ok: false, error: `Falta dato obligatorio: ${k}` };
    }
  }

  const cycle = {
    ciclo: Number(id),
    invertido_rub: toNumber(payload.invertido_rub),
    precio_usd_rub: toNumber(payload.precio_usd_rub),
    comision_usdt: toNumber(payload.comision_usdt),
    usdt_comprados: toNumber(payload.usdt_comprados),
    precio_usd_cup: toNumber(payload.precio_usd_cup),

    // estos 3 los puedes llenar luego si quieres (Excel full)
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

  // Si no viene CUP disponibles pero viene CUP bruto y comisión CUP, calcúlalo
  const cupBruto = toNumber(payload.cup_bruto);
  const comCUP = toNumber(payload.comision_cup);
  if (cycle.cup_libres === null && cupBruto !== null && comCUP !== null) {
    cycle.cup_libres = round2(cupBruto - comCUP);
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

  // Si CUP disponibles no viene pero bruto y comisión sí, calcúlalo
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

  // Si no trae RUB y hay tasa, estimamos
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
   WIZARD (MODO 2) CON ESTADO
   ========================= */
const WIZARD = new Map(); // sessionId => { step, draft }

/* =========================
   PROMPT ELARA (HUMANA)
   ========================= */
const SYSTEM_RULES = `
Eres ELARA, asistente femenina premium para gestionar ciclos de remesas (RUB↔CUP).
Tono: cálido, claro, cero robot. Hablas como una asistente humana.
No muestres nombres internos de variables/columnas.

REGLAS:
- No inventes números. Si falta algo, pregunta 1 cosa concreta con ejemplo corto.
- Si el usuario dice “calcula tú”, calcula lo posible y confirma (sin inventar lo que no se pueda).
- Termina con: "Próximo paso: ..."

FORMATO:
Responde SIEMPRE en JSON válido:
{ "say": "...", "actions": [ ... ] }
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

app.post("/api/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const sessionId = (req.body?.sessionId || "default").toString();

    if (!message) return res.status(400).json({ error: "Mensaje vacío" });

    if (!WIZARD.has(sessionId)) WIZARD.set(sessionId, { draft: {}, step: 0 });
    const wiz = WIZARD.get(sessionId);

    const user = message.toLowerCase();
    const isNewCycleIntent = /(crear|nuevo|iniciar|abrir)\s+(un\s+)?ciclo/.test(user);
    const isCancel = /(cancelar|salir|stop|parar|terminar)\b/.test(user);

    // Cancelar wizard
    if (isCancel && wiz.step > 0) {
      wiz.draft = {};
      wiz.step = 0;
      const reply =
        "Listo, cancelé la creación del ciclo. Próximo paso: dime si quieres crear uno nuevo o revisar un ciclo existente.";
      return res.json({
        reply,
        history: [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }],
      });
    }

    // Iniciar wizard
    if (isNewCycleIntent && wiz.step === 0) {
      wiz.draft = {};
      wiz.step = 1;
      const reply =
        "Perfecto. Vamos suave 😄 ¿Qué número de ciclo es? (ej: 6)\nPróximo paso: dime el número.";
      return res.json({
        reply,
        history: [...history.slice(-12), { role: "user", content: message }, { role: "assistant", content: reply }],
      });
    }

    // Wizard activo: 1 dato por turno
    if (wiz.step > 0) {
      const n = toNumber(message);

      // 1) ciclo
      if (wiz.step === 1) {
        if (!n) {
          const reply = "Dime solo el número del ciclo (ej: 6).\nPróximo paso: envíame el número.";
          return res.json({ reply });
        }
        wiz.draft.ciclo = Math.trunc(n);
        wiz.step = 2;
        const reply = `Perfecto, ciclo ${wiz.draft.ciclo}. ¿Cuántos RUB invertiste? (ej: 11000)\nPróximo paso: dime el invertido.`;
        return res.json({ reply });
      }

      // 2) invertido
      if (wiz.step === 2) {
        if (n === null) {
          const reply = "¿Cuántos RUB invertiste? Solo número (ej: 11000).\nPróximo paso: envíame el monto.";
          return res.json({ reply });
        }
        wiz.draft.invertido_rub = n;
        wiz.step = 3;
        const reply = "¿A qué precio compraste el USDT en RUB? (ej: 80)\nPróximo paso: dime el precio USDT/RUB.";
        return res.json({ reply });
      }

      // 3) precio usdt/rub
      if (wiz.step === 3) {
        if (n === null) {
          const reply = "Dime el precio USDT/RUB (ej: 80).\nPróximo paso: envíame ese precio.";
          return res.json({ reply });
        }
        wiz.draft.precio_usd_rub = n;
        wiz.step = 4;
        const reply = "¿Cuál fue la comisión en USDT? (ej: 0,99)\nPróximo paso: dime la comisión USDT.";
        return res.json({ reply });
      }

      // 4) comisión usdt
      if (wiz.step === 4) {
        if (n === null) {
          const reply = "Dime la comisión USDT (ej: 0,99).\nPróximo paso: envíame la comisión.";
          return res.json({ reply });
        }
        wiz.draft.comision_usdt = n;
        wiz.step = 5;
        const reply =
          "¿Cuántos USDT compraste? Si no sabes exacto, escribe “calcula tú” y lo estimo.\nPróximo paso: dime los USDT.";
        return res.json({ reply });
      }

      // 5) usdt comprados (acepta calcula tú)
      if (wiz.step === 5) {
        if (/calcula|estima|tu calcula|hazlo tu/i.test(message)) {
          const inv = toNumber(wiz.draft.invertido_rub);
          const px = toNumber(wiz.draft.precio_usd_rub);
          const fee = toNumber(wiz.draft.comision_usdt) || 0;
          if (inv !== null && px && px !== 0) {
            const est = round2(inv / px - fee);
            wiz.draft.usdt_comprados = est;
            wiz.step = 6;
            const reply =
              `Listo. Estimo ~${est} USDT (incluyendo comisión). ¿A qué precio está el USD/CUP? (ej: 562)\nPróximo paso: dime el USD/CUP.`;
            return res.json({ reply });
          }
          const reply =
            "Puedo estimarlo, pero me falta algo (invertido o precio USDT/RUB).\nPróximo paso: dime el dato que falta.";
          return res.json({ reply });
        }

        if (n === null) {
          const reply =
            "Dime los USDT comprados (ej: 136,51) o escribe “calcula tú”.\nPróximo paso: envíame ese dato.";
          return res.json({ reply });
        }
        wiz.draft.usdt_comprados = n;
        wiz.step = 6;
        const reply = "Perfecto. ¿A qué precio está el USD/CUP? (ej: 562)\nPróximo paso: dime el USD/CUP.";
        return res.json({ reply });
      }

      // 6) precio usd/cup
      if (wiz.step === 6) {
        if (n === null) {
          const reply = "Dime el precio USD/CUP (ej: 562).\nPróximo paso: envíame ese precio.";
          return res.json({ reply });
        }
        wiz.draft.precio_usd_cup = n;
        wiz.step = 7;
        const reply = "¿Cuál fue la comisión en CUP? (ej: 2301,56)\nPróximo paso: dime la comisión CUP.";
        return res.json({ reply });
      }

      // 7) comisión cup => crear ciclo
      if (wiz.step === 7) {
        if (n === null) {
          const reply = "Dime la comisión CUP (ej: 2301,56).\nPróximo paso: envíame la comisión.";
          return res.json({ reply });
        }
        wiz.draft.comision_cup = n;

        const data = loadData();
        const payload = {
          ciclo: wiz.draft.ciclo,
          invertido_rub: wiz.draft.invertido_rub,
          precio_usd_rub: wiz.draft.precio_usd_rub,
          comision_usdt: wiz.draft.comision_usdt,
          usdt_comprados: wiz.draft.usdt_comprados,
          precio_usd_cup: wiz.draft.precio_usd_cup,
          comision_cup: wiz.draft.comision_cup,
        };

        const created = createCycle(data, payload);
        saveData(data);

        // reset wizard
        wiz.draft = {};
        wiz.step = 0;

        if (!created.ok) {
          const reply = `No pude crear el ciclo: ${created.error}.\nPróximo paso: dime qué dato quieres corregir.`;
          return res.json({ reply });
        }

        const reply =
          `Listo, ciclo ${payload.ciclo} creado ✅.\nPróximo paso: ¿añadimos una liberación? (CUP liberados + tasa RUB/CUP + RUB recibidos)`;
        return res.json({ reply });
      }
    }

    /* =========================
       MODO AI NORMAL (SIN WIZARD)
       ========================= */
    const data = loadData();

    // Contexto compacto (últimos 15)
    const cyclesCompact = listCycles(data)
      .slice(-15)
      .map((c) => ({
        ciclo: c.ciclo,
        estado: c.estado,
        invertido_rub: c.invertido_rub,
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
          `Mensaje: ${message}\n\n` +
          `Resumen ciclos (últimos): ${JSON.stringify(cyclesCompact)}\n\n` +
          `Si quieres ejecutar algo real, devuelve actions: create_cycle, update_cycle, add_liberacion, get_cycle, list_cycles.`,
      },
    ];

    const ai = await client.responses.create({
      model: "gpt-5-mini",
      instructions: SYSTEM_RULES,
      input,
    });

    const raw = (ai.output_text || "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { say: raw || "No pude interpretar eso.", actions: [] };
    }

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

    // Recalcular todo por seguridad
    for (const id of Object.keys(data.cycles)) calcCycleDerived(data, id);
    saveData(data);

    let extra = "";
    if (results.length) {
      const okCount = results.filter((r) => r.result?.ok).length;
      const badCount = results.length - okCount;
      extra = `\n(Ejecución: ${okCount} OK${badCount ? `, ${badCount} error` : ""})`;
    }

    const reply = `${(parsed.say || "Listo.").trim()}${extra}`.trim();

    const newHistory = [
      ...history.slice(-12),
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ];

    res.json({ reply, history: newHistory, results });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    res.status(500).json({ error: "Error en /api/chat" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("ELARA running on", port));
