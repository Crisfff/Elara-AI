const chatBody = document.getElementById("chatBody");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");

const cyclesList = document.getElementById("cyclesList");

const messages = [
  { from: "user", text: "Hola! ¿Cuál es el estado actual del ciclo?" },
  { from: "ai", text: "El ciclo actual está en progreso. ¿Necesitas algún reporte?" },
  { from: "user", text: "Sí, ¿puedes mostrarme el resumen del ciclo?" },
  { from: "ai", text: "Claro, aquí tienes el resumen del ciclo actual..." },
  { from: "user", text: "Gracias, se ve bien." },
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
      pushAiMessage(`Listo. Mostrando detalles del ciclo ${c.id} (demo).`);
    });
    cyclesList.appendChild(btn);
  }
}

/* ===== ELARA Demo Brain (por ahora sin DB/IA real) ===== */
function elaraDemoReply(userText) {
  const t = (userText || "").toLowerCase();

  if (t.includes("estado")) return "Ciclo actual: en progreso. Avance 75 por ciento.";
  if (t.includes("resumen")) return "Resumen del ciclo actual: 72 mil rublos movidos y ganancia neta de 4 mil 250.";
  if (t.includes("historial")) return "Historial: tengo ciclos recientes listados a la derecha. Dime cuál quieres abrir.";
  if (t.includes("ganancia")) return "En demo: la ganancia neta del ciclo actual es 4 mil 250 rublos.";
  if (t.includes("reporte")) return "Reporte demo generado. Después lo exportamos a PDF o Excel.";
  if (t.includes("crear ciclo") || t.includes("nuevo ciclo"))
    return "Perfecto. Dime cliente, monto en rublos y tasa. Por ahora lo registro como demo.";

  return "Te escucho. Dime qué quieres hacer con los ciclos: crear, ver historial, abrir un ciclo o generar reporte.";
}

/* ===== Text-to-Speech (ELARA habla) ===== */
function speak(text) {
  if (!("speechSynthesis" in window)) return;

  // evita solaparse
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-ES";
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;

  window.speechSynthesis.speak(u);
}

function pushAiMessage(text) {
  messages.push({ from: "ai", text });
  renderMessages();
  speak(text);
}

/* ===== Enviar texto normal ===== */
function sendText() {
  const text = (chatInput.value || "").trim();
  if (!text) return;

  messages.push({ from: "user", text });
  chatInput.value = "";
  renderMessages();

  const reply = elaraDemoReply(text);
  pushAiMessage(reply);
}

sendBtn.addEventListener("click", sendText);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

/* ===== Chips rápidas ===== */
document.querySelectorAll(".pill").forEach((b) => {
  b.addEventListener("click", () => {
    const action = b.getAttribute("data-action");

    if (action === "estado") {
      messages.push({ from: "user", text: "Estado actual" });
      pushAiMessage("Ciclo actual: En Progreso. Avance 75 por ciento.");
      return;
    }

    if (action === "resumen") {
      messages.push({ from: "user", text: "Resumen del ciclo" });
      pushAiMessage("Resumen demo: 72 mil rublos movidos y ganancia neta de 4 mil 250.");
      return;
    }

    messages.push({ from: "user", text: "Generar reporte" });
    pushAiMessage("Reporte demo generado. Luego lo exportamos a PDF o Excel.");
  });
});

/* ===== Voice: Speech-to-Text ===== */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

function startVoice() {
  if (!SpeechRecognition) {
    alert("Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.interimResults = true;
  recognition.continuous = false;

  isRecording = true;
  voiceBtn.classList.add("rec");
  voiceBtn.textContent = "⏺️";

  let finalText = "";

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    chatInput.value = (finalText || interim).trim();
  };

  recognition.onerror = () => stopVoice();

  recognition.onend = () => {
    // al terminar, enviamos lo que quedó
    const text = (chatInput.value || "").trim();
    stopVoice();
    if (text) {
      messages.push({ from: "user", text });
      chatInput.value = "";
      renderMessages();

      const reply = elaraDemoReply(text);
      pushAiMessage(reply);
    }
  };

  recognition.start();
}

function stopVoice() {
  isRecording = false;
  voiceBtn.classList.remove("rec");
  voiceBtn.textContent = "🎙️";
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
}

voiceBtn.addEventListener("click", () => {
  if (isRecording) stopVoice();
  else startVoice();
});

/* ===== Init ===== */
renderMessages();
renderCycles();
