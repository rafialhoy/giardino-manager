/* app.js (module)
   - Password gate (single shared password)
   - Supabase sync only when logged in; otherwise local-only
   - Hidden-overlay fix: use hidden + display
   - Safe date math (Mon→Sun), COP formatting, resilient storage
*/

/* ===== Env & optional Supabase client ===== */
const ENV = window.__ENV ?? {};
const GATE_MODE = (ENV.GATE_MODE || "supabase").toLowerCase(); // 'supabase' | 'hash'
const HAS_SUPABASE = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);

let supabase = null;
let signedInUser = null;

async function ensureSupabase() {
  if (!HAS_SUPABASE) return null;
  if (!supabase) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }
  return supabase;
}

/* ===== Small helpers ===== */
async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function isUnlocked() {
  try { return localStorage.getItem("gate_unlock_v1") === "1"; } catch { return false; }
}
function setUnlocked(v) {
  try { localStorage.setItem("gate_unlock_v1", v ? "1" : "0"); } catch {}
}

/* ===== Password gate (blocks UI until unlocked) ===== */
function showGate() {
  const ov  = document.getElementById("gate-overlay");
  const input = document.getElementById("gate-pass");
  const btn = document.getElementById("gate-submit");
  const err = document.getElementById("gate-error");
  if (!ov || !input || !btn || !err) return;

  // Explicitly show (fix for CSS overriding [hidden])
  ov.hidden = false;
  ov.style.display = "grid";

  async function handleSubmit() {
    err.textContent = "";
    const pass = (input.value || "").trim();
    if (!pass) { input.focus(); return; }

    try {
      if (GATE_MODE === "supabase") {
        if (!HAS_SUPABASE) throw new Error("Supabase not configured");
        if (!ENV.MANAGER_EMAIL) throw new Error("MANAGER_EMAIL missing in env.js");
        const sb = await ensureSupabase();
        const { data, error } = await sb.auth.signInWithPassword({
          email: ENV.MANAGER_EMAIL,
          password: pass
        });
        if (error) throw error;
        signedInUser = data?.user ?? null;
      } else {
        // Local hash-only gate
        if (!ENV.PASS_HASH) throw new Error("PASS_HASH missing");
        const hex = await sha256Hex(pass);
        if (hex !== ENV.PASS_HASH) throw new Error("Invalid password");
        signedInUser = null; // local-only
      }

      setUnlocked(true);

      // Explicitly hide (fix for CSS overriding [hidden])
      ov.hidden = true;
      ov.style.display = "none";

      // important: blur to release iOS zoom focus, then reset scroll
input.blur();
setTimeout(() => { window.scrollTo(0, 0); }, 0);

      await afterUnlockInit();
    } catch (e) {
      err.textContent = e.message || "Authentication failed";
      input.select();
      console.error("[Gate] unlock failed:", e);
    }
  }

  btn.onclick = handleSubmit;
  input.onkeydown = (e) => { if (e.key === "Enter") handleSubmit(); };
  setTimeout(() => input.focus(), 50);
}

/* ===== After gate unlock: init page state ===== */
async function afterUnlockInit() {
  try {
    if (GATE_MODE === "supabase" && HAS_SUPABASE) {
      const sb = await ensureSupabase();
      const { data: { user } } = await sb.auth.getUser();
      signedInUser = signedInUser || user || null;
    }

    // Set default date if empty
    if (elDate && !elDate.value) {
      const d = new Date();
      elDate.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    await refreshForSelectedDate();

    // Nice footer hint when syncing to cloud
    const footer = document.querySelector("footer.muted");
    if (footer && provider.mode === "supabase") {
      footer.textContent = "Toda la información es almacenada en la nube de manera segura y gratuita.";
    }
  } catch (err) {
    console.error("[Init] failed:", err);
  }
}

/* ===== Boot ===== */
(async function boot() {
  try {
    if (GATE_MODE === "supabase") {
      await ensureSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      signedInUser = user ?? null;
    }
    if (isUnlocked()) {
      await afterUnlockInit();
    } else {
      showGate();
    }
  } catch (e) {
    console.error("[Boot] failed:", e);
    showGate();
  }
})();

/* ===== Formatting & date utilities ===== */
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});
const fmtCOP = (n) => COP.format(Math.max(0, Math.round(Number(n) || 0)));

const todayLocalYYYYMMDD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const parseYYYYMMDD = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const yearMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function weekBounds(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();               // 0=Sun, 1=Mon…
  const diffToMon = (dow + 6) % 7;      // Sun->6, Mon->0…
  const monday = new Date(d); monday.setDate(d.getDate() - diffToMon);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return [monday, sunday];
}
const inRange = (date, a, b) => +date >= +a && +date <= +b;

/* ===== Local cache (always available + offline) ===== */
const LOCAL_KEY = "rm_dailyLogs";
function loadLocal() { try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function saveLocal(obj) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch {} }

/* ===== Data provider (cloud if signed in, else local) ===== */
const provider = {
  get mode() {
    return (GATE_MODE === "supabase" && supabase && signedInUser) ? "supabase" : "local";
  },
  monthCache: {},

  async hydrateMonth(selectedDate) {
    const yKey = yearMonthKey(selectedDate);
    this.monthCache = {};

    if (this.mode === "supabase") {
      const mStart = ymdLocal(startOfMonth(selectedDate));
      const mEnd   = ymdLocal(endOfMonth(selectedDate));
      const { data, error } = await supabase
        .from("daily_logs")
        .select("log_date, sales")
        .gte("log_date", mStart)
        .lte("log_date", mEnd)
        .order("log_date", { ascending: true });
      if (error) throw error;

      (data || []).forEach(r => { this.monthCache[r.log_date] = Number(r.sales) || 0; });

      // Mirror to local for offline UX
      const local = loadLocal();
      for (const [k, v] of Object.entries(this.monthCache)) local[k] = v;
      saveLocal(local);
    } else {
      const all = loadLocal();
      for (const [k, v] of Object.entries(all)) {
        if (yearMonthKey(parseYYYYMMDD(k)) === yKey) this.monthCache[k] = Number(v) || 0;
      }
    }
  },

  async listBetween(startDate, endDate) {
    if (this.mode === "supabase") {
      const s = ymdLocal(startDate);
      const e = ymdLocal(endDate);
      const { data, error } = await supabase
        .from("daily_logs")
        .select("log_date, sales")
        .gte("log_date", s)
        .lte("log_date", e)
        .order("log_date", { ascending: true });
      if (error) throw error;
      return (data || []).map(r => ({ dateStr: r.log_date, sales: Number(r.sales) || 0 }));
    } else {
      const all = loadLocal();
      const out = [];
      for (const [k, v] of Object.entries(all)) {
        const d = parseYYYYMMDD(k);
        if (inRange(d, startDate, endDate)) out.push({ dateStr: k, sales: Number(v) || 0 });
      }
      out.sort((a,b) => a.dateStr < b.dateStr ? -1 : 1);
      return out;
    }
  },

  async upsert(dateStr, sales) {
    if (this.mode === "supabase") {
      const { error } = await supabase
        .from("daily_logs")
        .upsert({ log_date: dateStr, sales }, { onConflict: "user_id,log_date" });
      if (error) throw error;
    }
    const local = loadLocal();
    local[dateStr] = sales;
    saveLocal(local);
    this.monthCache[dateStr] = sales;
  },

  async remove(dateStr) {
    if (this.mode === "supabase") {
      const { error } = await supabase
        .from("daily_logs")
        .delete()
        .eq("log_date", dateStr);
      if (error) throw error;
    }
    const local = loadLocal();
    delete local[dateStr];
    saveLocal(local);
    delete this.monthCache[dateStr];
  }
};

/* ===== DOM ===== */
const elDate        = document.getElementById("date");
const elSales       = document.getElementById("sales");
const elPreview     = document.getElementById("salesPreview");
const elSave        = document.getElementById("saveBtn");
const elClear       = document.getElementById("clearBtn"); // optional
const elWeekTotal   = document.getElementById("weekTotal");
const elWeekRange   = document.getElementById("weekRange");
const elMonthTotal  = document.getElementById("monthTotal");
const elMonthLabel  = document.getElementById("monthLabel");
const elMissing     = document.getElementById("missing");
const elSurplusNote = document.getElementById("surplusNote");
const elDaysList    = document.getElementById("daysList");

/* ===== KPIs + List rendering ===== */
async function refreshForSelectedDate() {
  const dateStr  = elDate?.value || todayLocalYYYYMMDD();
  const selected = parseYYYYMMDD(dateStr);

  await provider.hydrateMonth(selected);

  const [wStart, wEnd] = weekBounds(selected);
  const weekLogs = await provider.listBetween(wStart, wEnd);
  const weekSum = weekLogs.reduce((a,r) => a + r.sales, 0);
  if (elWeekTotal) elWeekTotal.textContent = fmtCOP(weekSum);
  if (elWeekRange) elWeekRange.textContent = `${wStart.toLocaleDateString("en-CA")} → ${wEnd.toLocaleDateString("en-CA")}`;

  const mStart = startOfMonth(selected);
  const mEnd   = endOfMonth(selected);
  const monthLogs = await provider.listBetween(mStart, mEnd);
  const monthSum = monthLogs.reduce((a,r) => a + r.sales, 0);
  if (elMonthTotal) elMonthTotal.textContent = fmtCOP(monthSum);
  if (elMonthLabel) elMonthLabel.textContent = selected.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const target = 48000000;
  const missing = Math.max(0, target - monthSum);
  if (elMissing) elMissing.textContent = fmtCOP(missing);
  if (elSurplusNote) elSurplusNote.textContent = monthSum > target ? `Goal reached. Surplus: ${fmtCOP(monthSum - target)}` : "";

  renderMonthList(selected, provider.monthCache);

  const existing = provider.monthCache[dateStr];
  if (elSales) elSales.value = existing != null ? Number(existing) : "";
  if (elPreview) elPreview.textContent = `Formatted: ${fmtCOP(elSales?.value || 0)}`;
}

function renderMonthList(selected, store) {
  const mKey = yearMonthKey(selected);
  const items = Object.entries(store)
    .filter(([k]) => yearMonthKey(parseYYYYMMDD(k)) === mKey)
    .sort((a,b) => a[0] < b[0] ? -1 : 1);

  if (!elDaysList) return;
  elDaysList.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = "<small>No entries yet for this month.</small>";
    elDaysList.appendChild(li);
    return;
  }

  for (const [k, v] of items) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("div");
    left.innerHTML = `<strong>${k}</strong><br><small>${fmtCOP(v)}</small>`;

    const right = document.createElement("div");
    right.style.display = "flex"; right.style.gap = "10px";

    const editBtn = document.createElement("button");
    editBtn.className = "link"; editBtn.textContent = "Edit";
    editBtn.onclick = () => {
      if (elDate) elDate.value = k;
      if (elSales) elSales.value = Number(v);
      if (elSales) elSales.dispatchEvent(new Event("input"));
      refreshForSelectedDate();
    };

    const delBtn = document.createElement("button");
    delBtn.className = "link"; delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      if (confirm(`Delete entry for ${k}?`)) {
        await provider.remove(k);
        await refreshForSelectedDate();
      }
    };

    right.appendChild(editBtn);
    right.appendChild(delBtn);
    li.appendChild(left);
    li.appendChild(right);
    elDaysList.appendChild(li);
  }
}

/* ===== Events (guard every binding) ===== */
if (elSales) {
  elSales.addEventListener("input", () => {
    if (elPreview) elPreview.textContent = `Formatted: ${fmtCOP(elSales.value || 0)}`;
  });
}
if (elDate) {
  elDate.addEventListener("change", () => { refreshForSelectedDate(); });
}
if (elSave) {
  elSave.addEventListener("click", async () => {
    const dateStr = elDate?.value;
    const amt = Math.round(Number(elSales?.value));
    if (!dateStr) { alert("Please select a date."); elDate?.focus(); return; }
    if (!(amt >= 0)) { alert("Please enter a valid non-negative amount."); elSales?.focus(); return; }
    await provider.upsert(dateStr, amt);
    await refreshForSelectedDate();
  });
}
if (elClear) {
  elClear.addEventListener("click", async () => {
    if (provider.mode === "supabase") {
      if (confirm("Clear local cache only? (Your cloud data stays intact)")) {
        localStorage.removeItem(LOCAL_KEY);
        await refreshForSelectedDate();
      }
    } else {
      if (confirm("This will remove ALL saved data in this browser. Continue?")) {
        localStorage.removeItem(LOCAL_KEY);
        await refreshForSelectedDate();
      }
    }
  });
}

