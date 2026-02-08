/* =========================
   ELEMENTOS BASE (CHAT UI)
   ========================= */
const chatBody = document.getElementById("chatBody");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");
const cyclesList = document.getElementById("cyclesList");

const messages = [
  { from: "user", text: "Hola! ¿Cuál es el estado actual del ciclo?" },
  { from: "ai", text: "El ciclo actual está en progreso. ¿Necesitas algún reporte?" },
  { from: "user", text: "Sí, ¿puedes mostrarme el resumen del ciclo?" },
  { from: "ai", text: "Claro, aquí tienes el resumen del ciclo actual..." }
];

const cycles = [
  { id: 23, label: "Abril 2024" },
  { id: 22, label: "Marzo 2024" },
  { id: 21, label: "Febrero 2024" },
  { id: 20, label: "Enero 2024" },
  { id: 16, label: "Octubre 2023" },
  { id: 15, label: "Agosto 2023" },
];

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
      messages.push({ from: "user", text: `Abre el ciclo ${c.id}` });
      messages.push({ from: "ai", text: `Listo. Mostrando detalles del ciclo ${c.id} (demo).` });
      renderMessages();
    });
    cyclesList.appendChild(btn);
  }
}

/* Respuesta demo (mientras no hay IA real) */
function elaraDemoReply(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("estado")) return "Ciclo actual: en progreso. Avance 75%.";
  if (t.includes("resumen")) return "Resumen demo: 72 000 ₽ movidos. Ganancia neta +4 250 ₽.";
  if (t.includes("reporte")) return "Reporte demo generado. Luego lo exportamos a PDF/Excel.";
  return "Entendido. (Demo) Dime qué quieres hacer con los ciclos.";
}

function sendText() {
  const text = (chatInput.value || "").trim();
  if (!text) return;

  messages.push({ from: "user", text });
  chatInput.value = "";
  renderMessages();

  const reply = elaraDemoReply(text);
  messages.push({ from: "ai", text: reply });
  renderMessages();
}

sendBtn.addEventListener("click", sendText);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

document.querySelectorAll(".pill").forEach((b) => {
  b.addEventListener("click", () => {
    const action = b.getAttribute("data-action");
    if (action === "estado") {
      messages.push({ from: "user", text: "Estado actual" });
      messages.push({ from: "ai", text: "Ciclo actual: En Progreso (75%)." });
    } else if (action === "resumen") {
      messages.push({ from: "user", text: "Resumen del ciclo" });
      messages.push({ from: "ai", text: "Resumen demo: RUB movido 72 000₽, ganancia +4 250₽." });
    } else {
      messages.push({ from: "user", text: "Generar reporte" });
      messages.push({ from: "ai", text: "Reporte demo generado. Luego lo exportamos a PDF o Excel." });
    }
    renderMessages();
  });
});

/* =========================
   VOICE OVERLAY (CALL MODE)
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

  voiceStartStop.classList.remove("danger");
  voiceStartStop.classList.add("primary");
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

/* Abrir overlay desde el botón del chat */
voiceBtn.addEventListener("click", () => {
  if (!callOpen) openVoiceOverlay();
  else closeVoiceOverlay();
});

/* Cerrar overlay */
voiceClose.addEventListener("click", closeVoiceOverlay);
voiceEnd.addEventListener("click", closeVoiceOverlay);

/* Click fuera del modal (opcional) */
voiceOverlay.addEventListener("click", (e) => {
  if (e.target === voiceOverlay) closeVoiceOverlay();
});

/* Escape cierra */
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && callOpen) closeVoiceOverlay();
});

/* Hablar / Pausar (solo UI por ahora) */
voiceStartStop.addEventListener("click", () => {
  setLiveState(!callLive);
});

/* Mute (solo UI por ahora) */
voiceMute.addEventListener("click", () => {
  muted = !muted;
  voiceMute.querySelector("span").textContent = muted ? "Muted" : "Mute";
  voiceMute.firstChild.textContent = muted ? "🔈" : "🔇";
  if (callLive) {
    voiceHint.textContent = muted ? "Mute activado (demo)" : "Hablando… (demo)";
  }
});

/* =========================
   INIT
   ========================= */
renderMessages();
renderCycles();
