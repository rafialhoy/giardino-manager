/* app.js (Admin SPA: Dashboard + Carga) */

/* ===== Env & Supabase ===== */
const ENV = window.__ENV ?? {};
const GATE_MODE = (ENV.GATE_MODE || "supabase").toLowerCase();
const HAS_SUPABASE = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);
const ADMIN_EMAIL =
  window.__ENV?.MANAGER_EMAIL || "bellingrodtsimona@gmail.com";

let supabase = null;
let signedInUser = null;

async function ensureSupabase() {
  if (!HAS_SUPABASE) return null;
  if (!supabase) {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return supabase;
}

/* ===== Helpers ===== */
async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function isUnlocked() {
  try {
    return localStorage.getItem("gate_unlock_v1") === "1";
  } catch {
    return false;
  }
}
function setUnlocked(v) {
  try {
    localStorage.setItem("gate_unlock_v1", v ? "1" : "0");
  } catch {}
}
function hideGateOverlay() {
  const ov = document.getElementById("gate-overlay");
  if (ov) {
    ov.hidden = true;
    ov.style.display = "none";
  }
}

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const fmtCOP = (n) => COP.format(Math.max(0, Math.round(Number(n) || 0)));

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseYMD = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ===== DOM ===== */
// Tabs
const tabDashboard = document.getElementById("tabDashboard");
const tabCarga = document.getElementById("tabCarga");
const viewDashboard = document.getElementById("viewDashboard");
const viewCarga = document.getElementById("viewCarga");

// Dashboard
const rangeStart = document.getElementById("rangeStart");
const rangeEnd = document.getElementById("rangeEnd");
const applyRangeBtn = document.getElementById("applyRangeBtn");
const rangeHint = document.getElementById("rangeHint");
const alertBox = document.getElementById("alertBox");
const alertText = document.getElementById("alertText");

const kpiTotal = document.getElementById("kpiTotal");
const kpiTargets = document.getElementById("kpiTargets");
const kpiAvgDay = document.getElementById("kpiAvgDay");
const kpiAvgWeek = document.getElementById("kpiAvgWeek");
const kpiCash = document.getElementById("kpiCash");
const kpiCard = document.getElementById("kpiCard");
const kpiTrans = document.getElementById("kpiTrans");
const kpiPlat = document.getElementById("kpiPlat");

const monthsTableBody = document.getElementById("monthsTableBody");
const daysList = document.getElementById("daysList");

// --- Settings (modal) ---
const btnOpenSettings = document.getElementById("openSettings");
const settingsOverlay = document.getElementById("settings-overlay");
const inpEquilibrio = document.getElementById("inp-equilibrio");
const inpGanancia = document.getElementById("inp-ganancia");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnCancelSettings = document.getElementById("btn-cancel-settings");
const settingsError = document.getElementById("settings-error");

// Metas en el tablero
const kpiEquilibrio = document.getElementById("kpiEquilibrio");
const kpiGanancia = document.getElementById("kpiGanancia");

// Carga
const aDate = document.getElementById("adm-date");
const aEmp = document.getElementById("adm-employee");
const aCash = document.getElementById("adm-cash");
const aCard = document.getElementById("adm-card");
const aTrans = document.getElementById("adm-transfer");
const aPlat = document.getElementById("adm-platforms");
const aPrev = document.getElementById("adm-total-preview");
const aSave = document.getElementById("adm-saveBtn");
const aStatus = document.getElementById("adm-statusMsg");
const aMissing = document.getElementById("adm-missing");

// Gate
const ov = document.getElementById("gate-overlay");
const pIn = document.getElementById("gate-pass");
const pBtn = document.getElementById("gate-submit");
const pErr = document.getElementById("gate-error");

/* ===== State ===== */
let MONTHLY_TARGET = 30000000;
let SURPLUS_TARGET = 0;
let RANGE = { start: null, end: null };

/* ===== Gate ===== */
function showGate() {
  if (!ov || !pIn || !pBtn || !pErr) return;
  ov.hidden = false;
  ov.style.display = "grid";
  pErr.textContent = "";
  setTimeout(() => pIn.focus(), 50);

  async function handleSubmit() {
    pErr.textContent = "";
    const pass = (pIn.value || "").trim();
    if (!pass) {
      pIn.focus();
      return;
    }

    try {
      if (GATE_MODE === "supabase") {
        if (!HAS_SUPABASE) throw new Error("Supabase no está configurado");
        const sb = await ensureSupabase();
        const { data, error } = await sb.auth.signInWithPassword({
          email: ADMIN_EMAIL,
          password: pass,
        });
        if (error) throw error;
        signedInUser = data?.user ?? null;
      } else {
        if (!ENV.PASS_HASH) throw new Error("Falta PASS_HASH");
        const hex = await sha256Hex(pass);
        if (hex !== ENV.PASS_HASH) throw new Error("Contraseña incorrecta");
        signedInUser = null;
      }

      setUnlocked(true);
      hideGateOverlay();
      pIn.blur();
      setTimeout(() => window.scrollTo(0, 0), 0);
      await afterUnlockInit();
    } catch (e) {
      pErr.textContent = e.message || "Error de autenticación";
      pIn.select();
    }
  }

  pBtn.onclick = handleSubmit;
  pIn.onkeydown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };
}

/* ===== Data access ===== */
async function fetchSettings() {
  if (!supabase)
    return { owner_id: null, monthly_target: 30000000, surplus_target: 0 };
  const { data } = await supabase
    .from("app_settings")
    .select("owner_id, monthly_target, surplus_target")
    .limit(1)
    .maybeSingle();
  return {
    owner_id: data?.owner_id || null,
    monthly_target:
      typeof data?.monthly_target === "number" ? data.monthly_target : 30000000,
    surplus_target:
      typeof data?.surplus_target === "number" ? data.surplus_target : 0,
  };
}

let APP_SETTINGS_OWNER_ID = null;

async function fetchRangeLogs(s, e) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("daily_logs")
    .select(
      "log_date, employee_name, cash, card, bank_transfer, platforms, total"
    )
    .gte("log_date", ymd(s))
    .lte("log_date", ymd(e))
    .order("log_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchMonths(lastN = 6) {
  if (!supabase) return [];
  const now = new Date();
  const start = addMonths(startOfMonth(now), -lastN);
  const end = endOfMonth(now);
  const rows = await fetchRangeLogs(start, end);

  const map = new Map(); // YYYY-MM -> total
  for (const r of rows) {
    const d = parseYMD(r.log_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    map.set(key, (map.get(key) || 0) + (Number(r.total) || 0));
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/* ===== Dashboard render ===== */
function setDefaultRangeToCurrentMonth() {
  const now = new Date();
  RANGE.start = startOfMonth(now);
  RANGE.end = endOfMonth(now);
  if (rangeStart) rangeStart.value = ymd(RANGE.start);
  if (rangeEnd) rangeEnd.value = ymd(RANGE.end);
  if (rangeHint)
    rangeHint.textContent = `${RANGE.start.toLocaleDateString(
      "en-CA"
    )} → ${RANGE.end.toLocaleDateString("en-CA")}`;
}

function renderDaysList(rows) {
  if (!daysList) return;
  daysList.innerHTML = "";
  if (!rows || rows.length === 0) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = "<small>No hay registros en este rango.</small>";
    daysList.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "item";

    // Fecha con día de semana (español)
    const d = parseYMD(r.log_date);
    const label = cap(
      d.toLocaleDateString("es-CO", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    );

    const left = document.createElement("div");
    left.innerHTML = `<strong>${label}</strong><br><small>${fmtCOP(
      r.total
    )}</small>`;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "10px";

    const editBtn = document.createElement("button");
    editBtn.className = "link";
    editBtn.textContent = "Editar";
    editBtn.onclick = () => {
      showView("carga");
      aDate.value = r.log_date;
      aEmp.value = r.employee_name || "";
      aCash.value = Number(r.cash) || 0;
      aCard.value = Number(r.card) || 0;
      aTrans.value = Number(r.bank_transfer) || 0;
      aPlat.value = Number(r.platforms) || 0;
      updateAdmPreview();
      // refrescar faltantes del mes de esa fecha
      refreshMissingForCarga();
      aCash.focus();
    };

    const delBtn = document.createElement("button");
    delBtn.className = "link";
    delBtn.textContent = "Eliminar";
    delBtn.onclick = async () => {
      if (confirm(`Eliminar registro de ${label}?`)) {
        const { error } = await supabase
          .from("daily_logs")
          .delete()
          .eq("log_date", r.log_date);
        if (error) {
          alert(error.message || "Error al eliminar");
          return;
        }
        await refreshDashboard();
        // Si estamos en CARGA y el mes coincide, refrescar faltantes
        refreshMissingForCarga();
      }
    };

    right.appendChild(editBtn);
    right.appendChild(delBtn);
    li.appendChild(left);
    li.appendChild(right);
    daysList.appendChild(li);
  }
}

function renderMonthsTable(months, target) {
  if (!monthsTableBody) return;
  monthsTableBody.innerHTML = "";
  if (!months || months.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted" style="padding:8px 6px;">Sin datos</td>`;
    monthsTableBody.appendChild(tr);
    return;
  }
  for (const [key, total] of months) {
    const surplus = Math.max(0, total - target);
    const dt = new Date(
      Number(key.split("-")[0]),
      Number(key.split("-")[1]) - 1,
      1
    );
    const label = dt.toLocaleDateString("es-CO", {
      month: "long",
      year: "numeric",
    });
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border)";
    tr.innerHTML = `
      <td style="padding:8px 6px;">${cap(label)}</td>
      <td style="padding:8px 6px;">${fmtCOP(total)}</td>
      <td style="padding:8px 6px;">${fmtCOP(target)}</td>
      <td style="padding:8px 6px;">${fmtCOP(surplus)}</td>
    `;
    monthsTableBody.appendChild(tr);
  }
}

function renderKPIs(rows, target) {
  const daysCount = rows.length;
  const total = rows.reduce((a, r) => a + (Number(r.total) || 0), 0);
  const avgDay = daysCount ? total / daysCount : 0;

  // promedio/semana usando días naturales del rango
  const firstDate = rows[0]?.log_date || ymd(RANGE.start);
  const lastDate = rows.at(-1)?.log_date || ymd(RANGE.end);
  const rangeDays = Math.max(
    1,
    (parseYMD(lastDate) - parseYMD(firstDate)) / (1000 * 60 * 60 * 24) + 1
  );
  const avgWeek = (total / rangeDays) * 7;

  const sumCash = rows.reduce((a, r) => a + (Number(r.cash) || 0), 0);
  const sumCard = rows.reduce((a, r) => a + (Number(r.card) || 0), 0);
  const sumTrans = rows.reduce((a, r) => a + (Number(r.bank_transfer) || 0), 0);
  const sumPlat = rows.reduce((a, r) => a + (Number(r.platforms) || 0), 0);

  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);

  if (kpiTotal) kpiTotal.textContent = fmtCOP(total);
  if (kpiEquilibrio) kpiEquilibrio.textContent = fmtCOP(MONTHLY_TARGET);
  if (kpiGanancia) kpiGanancia.textContent = fmtCOP(SURPLUS_TARGET);

  if (kpiAvgDay) kpiAvgDay.textContent = fmtCOP(avgDay);
  if (kpiAvgWeek) kpiAvgWeek.textContent = fmtCOP(avgWeek);

  if (kpiCash) kpiCash.textContent = `${fmtCOP(sumCash)} (${pct(sumCash)}%)`;
  if (kpiCard) kpiCard.textContent = `${fmtCOP(sumCard)} (${pct(sumCard)}%)`;
  if (kpiTrans)
    kpiTrans.textContent = `${fmtCOP(sumTrans)} (${pct(sumTrans)}%)`;
  if (kpiPlat) kpiPlat.textContent = `${fmtCOP(sumPlat)} (${pct(sumPlat)}%)`;

  // Alerta del mes actual según meta de equilibrio
  const now = new Date();
  const inCurrentMonth =
    RANGE.start.getFullYear() === now.getFullYear() &&
    RANGE.start.getMonth() === now.getMonth() &&
    RANGE.end.getFullYear() === now.getFullYear() &&
    RANGE.end.getMonth() === now.getMonth();
  if (inCurrentMonth) {
    const first = startOfMonth(now),
      last = endOfMonth(now);
    const daysPassed = (((now - first) / (1000 * 60 * 60 * 24)) | 0) + 1;
    const daysInMonth = last.getDate();
    const daysLeft = daysInMonth - daysPassed;
    const avgSoFar = daysCount ? total / daysCount : 0;
    const projected = avgSoFar * daysInMonth;

    if (daysLeft <= 5 && projected < MONTHLY_TARGET) {
      alertBox.style.display = "block";
      alertText.textContent = `Faltan ${daysLeft} día(s). Proyección del mes: ${fmtCOP(
        projected
      )} (${fmtCOP(MONTHLY_TARGET - projected)} por debajo de la meta).`;
    } else {
      alertBox.style.display = "none";
      alertText.textContent = "";
    }
  } else {
    alertBox.style.display = "none";
    alertText.textContent = "";
  }
}

async function refreshDashboard() {
  let s = RANGE.start,
    e = RANGE.end;
  if (!s || !e) setDefaultRangeToCurrentMonth();
  s = RANGE.start;
  e = RANGE.end;

  if (rangeHint)
    rangeHint.textContent = `${s.toLocaleDateString(
      "en-CA"
    )} → ${e.toLocaleDateString("en-CA")}`;

  const rows = await fetchRangeLogs(s, e);
  renderKPIs(rows, MONTHLY_TARGET);
  renderDaysList(rows);

  const months = await fetchMonths(6);
  renderMonthsTable(months, MONTHLY_TARGET);
}

/* ===== Carga (admin) ===== */
async function loadEmployees() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("employees")
    .select("name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  aEmp.innerHTML = '<option value="" disabled selected>Selecciona</option>';
  for (const row of data || []) {
    const opt = document.createElement("option");
    opt.value = row.name;
    opt.textContent = row.name;
    aEmp.appendChild(opt);
  }
}

function updateAdmPreview() {
  const total =
    (Number(aCash.value) || 0) +
    (Number(aCard.value) || 0) +
    (Number(aTrans.value) || 0) +
    (Number(aPlat.value) || 0);
  aPrev.textContent = `Total: ${fmtCOP(total)}`;
}

async function saveAdminEntry() {
  aStatus.textContent = "";
  const body = {
    log_date: aDate.value,
    employee_name: aEmp.value,
    cash: Math.max(0, Math.round(Number(aCash.value) || 0)),
    card: Math.max(0, Math.round(Number(aCard.value) || 0)),
    bank_transfer: Math.max(0, Math.round(Number(aTrans.value) || 0)),
    platforms: Math.max(0, Math.round(Number(aPlat.value) || 0)),
  };
  if (!body.log_date) {
    aStatus.textContent = "Falta fecha";
    aDate.focus();
    return;
  }
  if (!body.employee_name) {
    aStatus.textContent = "Selecciona empleado";
    aEmp.focus();
    return;
  }

  aSave.disabled = true;
  aSave.textContent = "Guardando…";
  try {
    const { error } = await supabase
      .from("daily_logs")
      .upsert(body, { onConflict: "log_date" });
    if (error) throw error;
    aStatus.textContent = "✅ Guardado";
    await refreshDashboard();
    await refreshMissingForCarga(); // actualizar faltantes
  } catch (e) {
    aStatus.textContent = `❌ ${e.message || "Error"}`;
  } finally {
    aSave.disabled = false;
    aSave.textContent = "Guardar";
  }
}

/* Días faltantes del mes (excepto lunes) */
async function refreshMissingForCarga() {
  if (!aMissing) return;
  const baseDate = aDate.value ? parseYMD(aDate.value) : new Date();
  const mStart = startOfMonth(baseDate);
  const mEnd = endOfMonth(baseDate);

  const rows = await fetchRangeLogs(mStart, mEnd);
  const set = new Set(rows.map((r) => r.log_date)); // YYYY-MM-DD con datos

  const missing = [];
  for (let day = 1; day <= mEnd.getDate(); day++) {
    const d = new Date(mStart.getFullYear(), mStart.getMonth(), day);
    const isMonday = d.getDay() === 1; // 1 = Lunes
    const ds = ymd(d);
    if (isMonday) continue;
    if (!set.has(ds)) missing.push(ds);
  }

  aMissing.innerHTML = "";
  if (missing.length === 0) {
    aMissing.innerHTML = '<span class="muted">No hay días faltantes.</span>';
    return;
  }
  for (const ds of missing) {
    const chip = document.createElement("button");
    chip.className = "chip";
    const dd = parseYMD(ds);
    chip.textContent = dd.getDate().toString().padStart(2, "0");
    chip.title = cap(
      dd.toLocaleDateString("es-CO", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    );
    chip.type = "button";
    chip.onclick = () => {
      aDate.value = ds;
      aDate.dispatchEvent(new Event("change"));
    };
    aMissing.appendChild(chip);
  }
}

/* ===== Tabs ===== */
function showView(name) {
  if (name === "dashboard") {
    viewDashboard.style.display = "";
    viewCarga.style.display = "none";
    tabDashboard.classList.remove("secondary");
    tabCarga.classList.add("secondary");
  } else {
    viewDashboard.style.display = "none";
    viewCarga.style.display = "";
    tabCarga.classList.remove("secondary");
    tabDashboard.classList.add("secondary");
    refreshMissingForCarga(); // actualizar faltantes al entrar
  }
}

/* ===== After unlock ===== */
async function afterUnlockInit() {
  if (GATE_MODE === "supabase" && HAS_SUPABASE) {
    const sb = await ensureSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    signedInUser = signedInUser || user || null;
  }

  // Targets
  const st = await fetchSettings();
  APP_SETTINGS_OWNER_ID = st.owner_id;
  MONTHLY_TARGET = st.monthly_target;
  SURPLUS_TARGET = st.surplus_target;

  // Dashboard defaults
  setDefaultRangeToCurrentMonth();
  await refreshDashboard();

  // Carga defaults
  if (!aDate.value) aDate.value = todayLocal();
  await loadEmployees();
  updateAdmPreview();
  await refreshMissingForCarga();

  // Listeners
  applyRangeBtn.addEventListener("click", async () => {
    const s = rangeStart.value,
      e = rangeEnd.value;
    if (s && e) {
      RANGE.start = parseYMD(s);
      RANGE.end = parseYMD(e);
      await refreshDashboard();
    }
  });
  tabDashboard.addEventListener("click", () => showView("dashboard"));
  tabCarga.addEventListener("click", () => showView("carga"));

  [aCash, aCard, aTrans, aPlat].forEach((el) =>
    el.addEventListener("input", updateAdmPreview)
  );
  aDate.addEventListener("change", refreshMissingForCarga);
  aSave.addEventListener("click", saveAdminEntry);

  showView("dashboard");

  // --- Settings modal ---
  function openSettings() {
    settingsError.textContent = "";
    inpEquilibrio.value = String(MONTHLY_TARGET || 0);
    inpGanancia.value = String(SURPLUS_TARGET || 0);
    settingsOverlay.hidden = false;
    settingsOverlay.style.display = "grid";
    setTimeout(() => inpEquilibrio.focus(), 20);
  }
  function closeSettings() {
    settingsOverlay.hidden = true;
    settingsOverlay.style.display = "none";
  }

  async function saveSettings() {
    settingsError.textContent = "";
    const mt = Math.max(0, Math.round(Number(inpEquilibrio.value || 0)));
    const st = Math.max(0, Math.round(Number(inpGanancia.value || 0)));

    if (!APP_SETTINGS_OWNER_ID) {
      settingsError.textContent =
        "No se encontró app_settings en la base de datos.";
      return;
    }
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = "Guardando…";
    try {
      const { error } = await supabase
        .from("app_settings")
        .update({ monthly_target: mt, surplus_target: st })
        .eq("owner_id", APP_SETTINGS_OWNER_ID);
      if (error) throw error;

      // Actualiza estado y UI
      MONTHLY_TARGET = mt;
      SURPLUS_TARGET = st;
      if (kpiEquilibrio) kpiEquilibrio.textContent = fmtCOP(MONTHLY_TARGET);
      if (kpiGanancia) kpiGanancia.textContent = fmtCOP(SURPLUS_TARGET);
      await refreshDashboard();
      closeSettings();
    } catch (e) {
      settingsError.textContent = e.message || "Error al guardar";
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = "Guardar";
    }
  }

  btnOpenSettings?.addEventListener("click", openSettings);
  btnCancelSettings?.addEventListener("click", closeSettings);
  btnSaveSettings?.addEventListener("click", saveSettings);
  settingsOverlay?.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
}

/* ===== Boot ===== */
(async function boot() {
  try {
    if (GATE_MODE === "supabase") {
      await ensureSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedInUser = user ?? null;
    }
    if (isUnlocked()) {
      hideGateOverlay();
      await afterUnlockInit();
    } else {
      showGate();
    }
  } catch (e) {
    console.error("[Boot] failed:", e);
    showGate();
  }
})();
