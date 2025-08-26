// reporte.js
const ENV = window.__ENV ?? {};
const API = {
  rpcListEmployees: `${ENV.SUPABASE_URL}/rest/v1/rpc/list_employees`,
  rpcSubmit:        `${ENV.SUPABASE_URL}/rest/v1/rpc/submit_employee_report`,
};
const HEADERS = {
  "Content-Type": "application/json",
  "apikey": ENV.SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${ENV.SUPABASE_ANON_KEY}`,
};

// ===== Utilidades =====
const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtCOP = (n) => COP.format(Math.max(0, Math.round(Number(n) || 0)));
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

// ===== DOM =====
const ov   = document.getElementById("gate-overlay");
const pIn  = document.getElementById("gate-pass");
const pBtn = document.getElementById("gate-submit");
const pErr = document.getElementById("gate-error");

const elDate   = document.getElementById("rep-date");
const elEmp    = document.getElementById("rep-employee");
const inCash   = document.getElementById("in-cash");
const inCard   = document.getElementById("in-card");
const inTrans  = document.getElementById("in-transfer");
const inPlat   = document.getElementById("in-platforms");
const totalPv  = document.getElementById("total-preview");
const sendBtn  = document.getElementById("sendBtn");
const statusEl = document.getElementById("statusMsg");

// Estado
let EMP_PASS = ""; // se mantiene solo en memoria (no se persiste)

// ===== Gate (valida clave y carga empleados) =====
async function unlockWithPass(pass) {
  // Llama al RPC para obtener los nombres (si la clave es válida).
  const res = await fetch(API.rpcListEmployees, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ p_pass: pass })
  });

  const ok = res.ok;
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!ok) {
    const msg = data?.message || data?.error || "Error de servidor";
    throw new Error(msg);
  }

  // data es un array de { name }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Clave válida pero no hay empleados activos.");
  }

  // Poblar select
  elEmp.innerHTML = '<option value="" disabled selected>Selecciona tu nombre</option>';
  for (const row of data) {
    const opt = document.createElement("option");
    opt.value = row.name;
    opt.textContent = row.name;
    elEmp.appendChild(opt);
  }
}

function showGate() {
  ov.hidden = false;
  ov.style.display = "grid";
  pErr.textContent = "";
  setTimeout(() => pIn?.focus(), 50);
}
function hideGate() {
  ov.hidden = true;
  ov.style.display = "none";
  pIn.blur();
  setTimeout(() => window.scrollTo(0,0), 0);
}

// ===== Preview total =====
function updatePreview() {
  const total =
    (Number(inCash.value)  || 0) +
    (Number(inCard.value)  || 0) +
    (Number(inTrans.value) || 0) +
    (Number(inPlat.value)  || 0);
  totalPv.textContent = `Total: ${fmtCOP(total)}`;
}

// ===== Submit =====
async function submitReport() {
  statusEl.textContent = "";
  const date = elDate.value;
  const name = elEmp.value;
  const body = {
    p_pass: EMP_PASS,
    p_date: date,
    p_employee_name: name,
    p_cash: Number(inCash.value)  || 0,
    p_card: Number(inCard.value)  || 0,
    p_bank_transfer: Number(inTrans.value) || 0,
    p_platforms: Number(inPlat.value) || 0,
  };

  // Validaciones mínimas
  if (!EMP_PASS) { statusEl.textContent = "Falta clave."; return; }
  if (!date)     { statusEl.textContent = "Falta la fecha."; elDate.focus(); return; }
  if (!name)     { statusEl.textContent = "Selecciona tu nombre."; elEmp.focus(); return; }

  sendBtn.disabled = true;
  sendBtn.textContent = "Enviando…";
  try {
    const res = await fetch(API.rpcSubmit, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const msg = data?.message || data?.error || "No se pudo enviar.";
      throw new Error(msg);
    }
    statusEl.textContent = "✅ Reporte enviado";
    // Opcional: limpiar importes
    // inCash.value = inCard.value = inTrans.value = inPlat.value = "";
    // updatePreview();
  } catch (e) {
    statusEl.textContent = `❌ ${e.message || "Error"}`;
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Enviar reporte";
  }
}

// ===== Wiring =====
[inCash, inCard, inTrans, inPlat].forEach(el => {
  el.addEventListener("input", updatePreview);
});
sendBtn.addEventListener("click", submitReport);

// Gate
pBtn.addEventListener("click", async () => {
  const pass = (pIn.value || "").trim();
  if (!pass) { pIn.focus(); return; }
  pBtn.disabled = true; pErr.textContent = "";
  try {
    await unlockWithPass(pass);
    EMP_PASS = pass;
    hideGate();
    if (!elDate.value) elDate.value = todayLocal();
    updatePreview();
    inCash.focus();
  } catch (e) {
    pErr.textContent = e.message || "Clave inválida";
    pIn.select();
  } finally {
    pBtn.disabled = false;
  }
});
pIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") pBtn.click();
});

// Boot: bloquear hasta ingresar clave
showGate();
