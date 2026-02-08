const chatBody = document.getElementById("chatBody");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

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
      messages.push({ from: "ai", text: `Listo. Mostrando detalles del ciclo ${c.id} (demo).` });
      renderMessages();
    });
    cyclesList.appendChild(btn);
  }
}

function send() {
  const text = (chatInput.value || "").trim();
  if (!text) return;
  messages.push({ from: "user", text });
  chatInput.value = "";

  // Respuesta demo (luego la conectamos a ELARA real)
  messages.push({
    from: "ai",
    text: "Recibido. (Demo) Cuando conectemos ELARA, esto ejecutará acciones reales en ciclos.",
  });

  renderMessages();
}

sendBtn.addEventListener("click", send);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

document.querySelectorAll(".pill").forEach((b) => {
  b.addEventListener("click", () => {
    const action = b.getAttribute("data-action");
    if (action === "estado") {
      messages.push({ from: "user", text: "Estado actual" });
      messages.push({ from: "ai", text: "Ciclo actual: En Progreso (75%)." });
    } else if (action === "resumen") {
      messages.push({ from: "user", text: "Resumen del ciclo" });
      messages.push({ from: "ai", text: "Resumen (demo): RUB movido 72 000₽, ganancia +4 250₽." });
    } else {
      messages.push({ from: "user", text: "Generar reporte" });
      messages.push({ from: "ai", text: "Reporte (demo) generado. Luego lo exportamos a PDF/Excel." });
    }
    renderMessages();
  });
});

renderMessages();
renderCycles();
