/* app.js (module)
   - Keeps your UI/logic
   - Data provider: Supabase (if env is present) or localStorage fallback
   - Safe date math (Mon→Sun week), COP formatting, and resilient storage
*/

/*** ---- ENV / Supabase bootstrap ---- ***/
// Expect window.__ENV injected by env.js
const ENV = (window.__ENV ?? {});
const HAS_SUPABASE = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);

let supabase = null;
if (HAS_SUPABASE) {
  // dynamic import keeps plain browsers happy, no bundler needed
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
}

/*** ---- Utilities ---- ***/
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

// helper to format local Y-M-D (avoids UTC shift issues)
const ymdLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};


const fmtCOP = (n) => COP.format(Math.max(0, Math.round(Number(n) || 0)));

const todayLocalYYYYMMDD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseYYYYMMDD = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const yearMonthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Week starts Monday: return [Mon, Sun]
function weekBounds(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();               // 0=Sun, 1=Mon, ...
  const diffToMon = (dow + 6) % 7;      // Sun(0)->6, Mon(1)->0, ...
  const monday = new Date(d); monday.setDate(d.getDate() - diffToMon);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return [monday, sunday];
}
const inRange = (date, a, b) => +date >= +a && +date <= +b;

/*** ---- Local cache (always available, also used as offline cache) ---- ***/
const LOCAL_KEY = "rm_dailyLogs";
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLocal(obj) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(obj));
  } catch {
    // Storage might be full/blocked; ignore silently to keep UX smooth
  }
}

/*** ---- Data provider: Supabase or Local ---- ***/
const provider = {
  mode: HAS_SUPABASE ? "supabase" : "local",
  // For UI rendering we keep a small month-scoped cache: { 'YYYY-MM-DD': sales }
  monthCache: {},

  // Ensure a user is signed in (Supabase only).
  async requireAuth() {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return user;
    const email = prompt("Enter your email to sign in via magic link:");
    if (!email) throw new Error("Sign-in cancelled");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) { alert(error.message); throw error; }
    alert("Check your email for a login link, then reload this page.");
    throw new Error("Awaiting email confirmation");
  },

  // Load month data into monthCache (from Supabase or Local)
  async hydrateMonth(selectedDate) {
    const yKey = yearMonthKey(selectedDate);
    this.monthCache = {}; // reset for the new month

    if (this.mode === "supabase") {
      await this.requireAuth();
      const mStart = ymdLocal(startOfMonth(selectedDate));
const mEnd   = ymdLocal(endOfMonth(selectedDate));
      const { data, error } = await supabase
        .from("daily_logs")
        .select("log_date, sales")
        .gte("log_date", mStart)
        .lte("log_date", mEnd)
        .order("log_date", { ascending: true });
      if (error) throw error;
      (data || []).forEach(row => { this.monthCache[row.log_date] = Number(row.sales) || 0; });

      // Mirror to local for offline UX
      const local = loadLocal();
      for (const [k,v] of Object.entries(this.monthCache)) local[k] = v;
      saveLocal(local);
    } else {
      // local mode: pull from localStorage
      const all = loadLocal();
      for (const [k,v] of Object.entries(all)) {
        if (yearMonthKey(parseYYYYMMDD(k)) === yKey) this.monthCache[k] = Number(v) || 0;
      }
    }
  },

  // List logs between (inclusive). Returns [{dateStr, sales}, ...]
  async listBetween(startDate, endDate) {
    if (this.mode === "supabase") {
      await this.requireAuth();
const s = ymdLocal(startDate);
const e = ymdLocal(endDate);
      const { data, error } = await supabase
        .from("daily_logs")
        .select("log_date, sales")
        .gte("log_date", s)
        .lte("log_date", e)
        .order("log_date", { ascending: true });
      if (error) throw error;
      return (data || []).map(r => ({ dateStr: r.log_date, sales: Number(r.sales)||0 }));
    } else {
      const all = loadLocal();
      const out = [];
      for (const [k, v] of Object.entries(all)) {
        const d = parseYYYYMMDD(k);
        if (inRange(d, startDate, endDate)) out.push({ dateStr: k, sales: Number(v)||0 });
      }
      out.sort((a,b) => a.dateStr < b.dateStr ? -1 : 1);
      return out;
    }
  },

  // Upsert one day
  async upsert(dateStr, sales) {
    if (this.mode === "supabase") {
      await this.requireAuth();
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("daily_logs")
        .upsert({ user_id: user.id, log_date: dateStr, sales }, { onConflict: "user_id,log_date" });
      if (error) throw error;
    }
    // Always update local cache for instant UI
    const local = loadLocal();
    local[dateStr] = sales;
    saveLocal(local);
    this.monthCache[dateStr] = sales;
  },

  // Delete one day
  async remove(dateStr) {
    if (this.mode === "supabase") {
      await this.requireAuth();
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("daily_logs")
        .delete()
        .eq("user_id", user.id)
        .eq("log_date", dateStr);
      if (error) throw error;
    }
    const local = loadLocal();
    delete local[dateStr];
    saveLocal(local);
    delete this.monthCache[dateStr];
  }
};

/*** ---- DOM ---- ***/
const elDate        = document.getElementById("date");
const elSales       = document.getElementById("sales");
const elPreview     = document.getElementById("salesPreview");
const elSave        = document.getElementById("saveBtn");
const elClear       = document.getElementById("clearBtn");
const elWeekTotal   = document.getElementById("weekTotal");
const elWeekRange   = document.getElementById("weekRange");
const elMonthTotal  = document.getElementById("monthTotal");
const elMonthLabel  = document.getElementById("monthLabel");
const elMissing     = document.getElementById("missing");
const elSurplusNote = document.getElementById("surplusNote");
const elDaysList    = document.getElementById("daysList");

async function refreshForSelectedDate() {
  const dateStr  = elDate.value || todayLocalYYYYMMDD();
  const selected = parseYYYYMMDD(dateStr);

  // Pull month cache from provider (Supabase or local)
  await provider.hydrateMonth(selected);

  // Week totals
  const [wStart, wEnd] = weekBounds(selected);
  const weekLogs = await provider.listBetween(wStart, wEnd);
  const weekSum = weekLogs.reduce((a, r) => a + r.sales, 0);
  elWeekTotal.textContent = fmtCOP(weekSum);
  elWeekRange.textContent = `${wStart.toLocaleDateString("en-CA")} → ${wEnd.toLocaleDateString("en-CA")}`;

  // Month totals
  const mStart = startOfMonth(selected);
  const mEnd   = endOfMonth(selected);
  const monthLogs = await provider.listBetween(mStart, mEnd);
  const monthSum = monthLogs.reduce((a, r) => a + r.sales, 0);
  elMonthTotal.textContent = fmtCOP(monthSum);
  elMonthLabel.textContent = selected.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Fixed monthly target
  const target  = 30000000; // COP
  const missing = Math.max(0, target - monthSum);
  elMissing.textContent = fmtCOP(missing);
  elSurplusNote.textContent = monthSum > target ? `Goal reached. Surplus: ${fmtCOP(monthSum - target)}` : "";

  // Populate month list (from month cache for speed)
  renderMonthList(selected, provider.monthCache);

  // Input hydration for the selected day
  const existing = provider.monthCache[dateStr];
  elSales.value = existing != null ? Number(existing) : "";
  elPreview.textContent = `Formatted: ${fmtCOP(elSales.value || 0)}`;
}

function renderMonthList(selected, store) {
  const mKey = yearMonthKey(selected);
  const items = Object.entries(store)
    .filter(([k]) => yearMonthKey(parseYYYYMMDD(k)) === mKey)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

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
    right.style.display = "flex";
    right.style.gap = "10px";

    const editBtn = document.createElement("button");
    editBtn.className = "link";
    editBtn.textContent = "Edit";
    editBtn.onclick = () => {
      elDate.value = k;
      elSales.value = Number(v);
      elSales.dispatchEvent(new Event("input"));
      refreshForSelectedDate();
    };

    const delBtn = document.createElement("button");
    delBtn.className = "link";
    delBtn.textContent = "Delete";
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

/*** ---- Events ---- ***/
elSales.addEventListener("input", () => {
  elPreview.textContent = `Formatted: ${fmtCOP(elSales.value || 0)}`;
});

elDate.addEventListener("change", () => {
  // Recompute when date context changes
  refreshForSelectedDate();
});

elSave.addEventListener("click", async () => {
  const dateStr = elDate.value;
  const amt = Math.round(Number(elSales.value));
  if (!dateStr) { alert("Please select a date."); elDate.focus(); return; }
  if (!(amt >= 0)) { alert("Please enter a valid non-negative amount."); elSales.focus(); return; }
  await provider.upsert(dateStr, amt);
  await refreshForSelectedDate();
});

elClear.addEventListener("click", async () => {
  if (provider.mode === "supabase") {
    // In cloud mode, don't mass-delete remote history from a single button.
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

const footer = document.querySelector('footer.muted');
if (footer && provider.mode === 'supabase') {
  footer.textContent = 'Data is stored in your Supabase project (cached locally for offline use).';
}


/*** ---- Init ---- ***/
(function init() {
  // If index.html didn’t pre-fill the date, default to today.
  if (!elDate.value) elDate.value = todayLocalYYYYMMDD();
  refreshForSelectedDate().catch(err => console.error(err));
})();
