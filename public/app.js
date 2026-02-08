/* =========================
   ELEMENTOS BASE (CHAT UI)
   ========================= */
const chatBody = document.getElementById("chatBody");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");
const cyclesList = document.getElementById("cyclesList");

/* =========================
   ESTADO DE CHAT (OpenAI)
   ========================= */
// Historial (para conversación real). Se guarda en memoria del navegador (solo mientras no recargues).
let history = []; // [{role:"user"|"assistant", content:string}]

const messages = [
  { from: "ai", text: "Hola, soy ELARA. Dime qué quieres hacer con tus ciclos. (Ya estoy conectada al backend)" }
];

const cycles = [
  { id: 23, label: "Abril 2024" },
  { id: 22, label: "Marzo 2024" },
  { id: 21, label: "Febrero 2024" },
  { id: 20, label: "Enero 2024" },
  { id: 16, label: "Octubre 2023" },
  { id: 15, label: "Agosto 2023" },
];

/* =========================
   RENDER UI
   ========================= */
function renderMessages() {
  chatBody.innerHTML = "";
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = `msg ${m.from === "user" ? "user" : "ai"}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.text;

    row.appendChild(bubble);
    chatBody.appendChild(row);
  }
  chatBody.scrollTop = chatBody.scrollHeight;
}

function renderCycles() {
  cyclesList.innerHTML = "";
  for (const c of cycles) {
    const btn = document.createElement("button");
    btn.className = "item";
    btn.innerHTML = `<div><span>Ciclo ${c.id}:</span> <b>${c.label}</b></div><div class="chev">›</div>`;
    btn.addEventListener("click", () => {
      // esto manda un mensaje a ELARA vía API, con contexto
      sendToElara(`Abre el ciclo ${c.id} y muéstrame un resumen breve.`, true);
    });
    cyclesList.appendChild(btn);
  }
}

/* =========================
   LLAMADA AL BACKEND /api/chat
   ========================= */
async function callChatAPI(userText) {
  const payload = {
    message: userText,
    history // le mandamos el historial para que ELARA mantenga contexto
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(err?.error || `HTTP ${res.status}`);
  }

  return await res.json(); // {reply, history?}
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function pushUserMessage(text) {
  messages.push({ from: "user", text });
  renderMessages();
}

function pushAiMessage(text) {
  messages.push({ from: "ai", text });
  renderMessages();
}

/**
 * sendToElara(text, silentInput=false)
 * - silentInput: si true, no pone el texto en el input, lo manda directo.
 */
async function sendToElara(text, silentInput = false) {
  const msg = (text || "").trim();
  if (!msg) return;

  // UI
  pushUserMessage(msg);
  if (!silentInput) chatInput.value = "";

  // pequeño “thinking”
  const thinkingIdx = messages.length;
  messages.push({ from: "ai", text: "..." });
  renderMessages();

  try {
    const data = await callChatAPI(msg);

    // quita thinking
    messages.splice(thinkingIdx - 0, 1);
    // respuesta
    const reply = (data?.reply || "").trim() || "No recibí respuesta del servidor.";
    pushAiMessage(reply);

    // actualiza historial
    if (Array.isArray(data?.history) && data.history.length) {
      history = data.history;
    } else {
      // fallback si el server no devuelve history
      history = [...history, { role: "user", content: msg }, { role: "assistant", content: reply }].slice(-12);
    }
  } catch (e) {
    // quita thinking
    messages.splice(thinkingIdx - 0, 1);
    pushAiMessage(`Error conectando con ELARA: ${e.message}`);
  }
}

/* =========================
   EVENTOS: ENVIAR TEXTO
   ========================= */
function sendText() {
  const text = (chatInput.value || "").trim();
  if (!text) return;
  sendToElara(text);
}

sendBtn.addEventListener("click", sendText);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

/* =========================
   CHIPS RÁPIDAS
   ========================= */
document.querySelectorAll(".pill").forEach((b) => {
  b.addEventListener("click", () => {
    const action = b.getAttribute("data-action");
    if (action === "estado") return sendToElara("Dime el estado actual del ciclo.");
    if (action === "resumen") return sendToElara("Muéstrame el resumen del ciclo actual.");
    return sendToElara("Genera un reporte del ciclo actual con puntos clave.");
  });
});

/* =========================
   VOICE OVERLAY (CALL MODE)
   Solo UI/estados por ahora
   ========================= */
const voiceOverlay = document.getElementById("voiceOverlay");
const voiceClose = document.getElementById("voiceClose");
const voiceEnd = document.getElementById("voiceEnd");
const voiceStartStop = document.getElementById("voiceStartStop");
const voiceMute = document.getElementById("voiceMute");
const voiceHint = document.getElementById("voiceHint");

let callOpen = false;
let callLive = false;
let muted = false;

function openVoiceOverlay() {
  callOpen = true;
  callLive = false;
  muted = false;

  voiceOverlay.classList.remove("hidden");
  voiceOverlay.classList.add("idle");
  voiceOverlay.classList.remove("live");
  voiceOverlay.setAttribute("aria-hidden", "false");

  voiceHint.textContent = "Toca “Hablar” para empezar";

  voiceStartStop.querySelector("span").textContent = "Hablar";
  voiceStartStop.firstChild.textContent = "🎙️";

  voiceMute.querySelector("span").textContent = "Mute";
  voiceMute.firstChild.textContent = "🔇";
}

function closeVoiceOverlay() {
  callOpen = false;
  callLive = false;

  voiceOverlay.classList.add("hidden");
  voiceOverlay.classList.remove("idle", "live");
  voiceOverlay.setAttribute("aria-hidden", "true");
}

function setLiveState(isLive) {
  callLive = isLive;

  if (isLive) {
    voiceOverlay.classList.remove("idle");
    voiceOverlay.classList.add("live");
    voiceHint.textContent = muted ? "Mute activado (demo)" : "Hablando… (demo)";
    voiceStartStop.querySelector("span").textContent = "Pausar";
    voiceStartStop.firstChild.textContent = "⏸️";
  } else {
    voiceOverlay.classList.remove("live");
    voiceOverlay.classList.add("idle");
    voiceHint.textContent = "Pausado. Toca “Hablar” para continuar";
    voiceStartStop.querySelector("span").textContent = "Hablar";
    voiceStartStop.firstChild.textContent = "🎙️";
  }
}

voiceBtn.addEventListener("click", () => {
  if (!callOpen) openVoiceOverlay();
  else closeVoiceOverlay();
});

voiceClose.addEventListener("click", closeVoiceOverlay);
voiceEnd.addEventListener("click", closeVoiceOverlay);

voiceOverlay.addEventListener("click", (e) => {
  if (e.target === voiceOverlay) closeVoiceOverlay();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && callOpen) closeVoiceOverlay();
});

voiceStartStop.addEventListener("click", () => {
  setLiveState(!callLive);
});

voiceMute.addEventListener("click", () => {
  muted = !muted;
  voiceMute.querySelector("span").textContent = muted ? "Muted" : "Mute";
  voiceMute.firstChild.textContent = muted ? "🔈" : "🔇";
  if (callLive) voiceHint.textContent = muted ? "Mute activado (demo)" : "Hablando… (demo)";
});

/* =========================
   INIT
   ========================= */
renderMessages();
renderCycles();
