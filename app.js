/* app.js (module)
   - Password gate (single shared password)
   - Supabase sync when gate is in "supabase" mode, else local-only
   - Safe date math (Mon→Sun), COP formatting, resilient storage
*/

/* ====== Env & Gate bootstrap ====== */
const ENV = window.__ENV ?? {};
const GATE_MODE = (ENV.GATE_MODE || 'supabase').toLowerCase(); // 'supabase' | 'hash'
const HAS_SUPABASE = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);
let supabase = null;

async function ensureSupabase() {
  if (!HAS_SUPABASE) return null;
  if (!supabase) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }
  return supabase;
}

async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isUnlocked() {
  try { return localStorage.getItem('gate_unlock_v1') === '1'; } catch { return false; }
}
function setUnlocked(v) {
  try { localStorage.setItem('gate_unlock_v1', v ? '1' : '0'); } catch {}
}

function showGate() {
  const ov = document.getElementById('gate-overlay');
  if (!ov) return;
  ov.hidden = false;
  const input = document.getElementById('gate-pass');
  const btn = document.getElementById('gate-submit');
  const err = document.getElementById('gate-error');

  async function handleSubmit() {
    err.textContent = '';
    const pass = (input.value || '').trim();
    if (!pass) { input.focus(); return; }

    try {
      if (GATE_MODE === 'supabase') {
        if (!HAS_SUPABASE) throw new Error('Supabase not configured');
        const sb = await ensureSupabase();
        const { error } = await sb.auth.signInWithPassword({
          email: ENV.MANAGER_EMAIL, // fixed email from env
          password: pass
        });
        if (error) throw error;
      } else {
        // Local hash gate
        if (!ENV.PASS_HASH) throw new Error('PASS_HASH missing');
        const hex = await sha256Hex(pass);
        if (hex !== ENV.PASS_HASH) throw new Error('Invalid password');
      }
      ov.hidden = true;
      setUnlocked(true);
      await afterUnlockInit();
    } catch (e) {
      err.textContent = e.message || 'Authentication failed';
      input.select();
    }
  }

  btn.onclick = handleSubmit;
  input.onkeydown = (e) => { if (e.key === 'Enter') handleSubmit(); };
  setTimeout(() => input?.focus(), 50);
}

async function afterUnlockInit() {
  // Default date if empty
  if (!document.getElementById('date').value) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const z = String(d.getDate()).padStart(2, '0');
    document.getElementById('date').value = `${y}-${m}-${z}`;
  }
  await refreshForSelectedDate();

  // Update footer copy when syncing to cloud
  const footer = document.querySelector('footer.muted');
  if (footer && provider.mode === 'supabase') {
    footer.textContent = 'Data is stored in your Supabase project (cached locally for offline use).';
  }
}

/* Boot: if session is valid & previously unlocked, go in; else show gate */
(async function boot() {
  if (GATE_MODE === 'supabase') {
    await ensureSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && isUnlocked()) {
      await afterUnlockInit();
    } else {
      showGate();
    }
  } else {
    if (isUnlocked()) {
      await afterUnlockInit();
    } else {
      showGate();
    }
  }
})();

/* ====== Utilities ====== */
const COP = new Intl.NumberFormat('la-CO' in Intl.NumberFormat.supportedLocalesOf ? 'la-CO' : 'es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

const fmtCOP = (n) => COP.format(Math.max(0, Math.round(Number(n) || 0)));

const todayLocalYYYYMMDD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseYYYYMMDD = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const yearMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Local Y-M-D to avoid UTC shifts
const ymdLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Week starts Monday: [Mon, Sun]
function weekBounds(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();           // 0=Sun, 1=Mon, ...
  const diffToMon = (dow + 6) % 7;  // Sun(0)->6, Mon(1)->0, ...
  const monday = new Date(d); monday.setDate(d.getDate() - diffToMon);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return [monday, sunday];
}
const inRange = (date, a, b) => +date >= +a && +date <= +b;

/* ====== Local cache (also used as offline cache) ====== */
const LOCAL_KEY = 'rm_dailyLogs';
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLocal(obj) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch {}
}

/* ====== Data provider: Supabase (when signed in) or Local ====== */
const provider = {
  // Cloud only when gate is 'supabase' AND client is initialized
  get mode() { return (GATE_MODE === 'supabase' && supabase) ? 'supabase' : 'local'; },

  // Month-scoped cache: { 'YYYY-MM-DD': sales }
  monthCache: {},

  async hydrateMonth(selectedDate) {
    const yKey = yearMonthKey(selectedDate);
    this.monthCache = {};

    if (this.mode === 'supabase') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const mStart = ymdLocal(startOfMonth(selectedDate));
      const mEnd   = ymdLocal(endOfMonth(selectedDate));
      const { data, error } = await supabase
        .from('daily_logs')
        .select('log_date, sales')
        .gte('log_date', mStart)
        .lte('log_date', mEnd)
        .order('log_date', { ascending: true });
      if (error) throw error;

      (data || []).forEach(r => { this.monthCache[r.log_date] = Number(r.sales) || 0; });

      // Mirror to local for offline UX
      const local = loadLocal();
      for (const [k, v] of Object.entries(this.monthCache)) local[k] = v;
      saveLocal(local);
    } else {
      // Local mode
      const all = loadLocal();
      for (const [k, v] of Object.entries(all)) {
        if (yearMonthKey(parseYYYYMMDD(k)) === yKey) {
          this.monthCache[k] = Number(v) || 0;
        }
      }
    }
  },

  // Inclusive range
  async listBetween(startDate, endDate) {
    if (this.mode === 'supabase') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const s = ymdLocal(startDate);
      const e = ymdLocal(endDate);
      const { data, error } = await supabase
        .from('daily_logs')
        .select('log_date, sales')
        .gte('log_date', s)
        .lte('log_date', e)
        .order('log_date', { ascending: true });
      if (error) throw error;
      return (data || []).map(r => ({ dateStr: r.log_date, sales: Number(r.sales) || 0 }));
    } else {
      const all = loadLocal();
      const out = [];
      for (const [k, v] of Object.entries(all)) {
        const d = parseYYYYMMDD(k);
        if (inRange(d, startDate, endDate)) out.push({ dateStr: k, sales: Number(v) || 0 });
      }
      out.sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1));
      return out;
    }
  },

  async upsert(dateStr, sales) {
    if (this.mode === 'supabase') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error } = await supabase
        .from('daily_logs')
        .upsert(
          { user_id: user.id, log_date: dateStr, sales },
          { onConflict: 'user_id,log_date' }
        );
      if (error) throw error;
    }
    // Always update local cache for instant UI & offline
    const local = loadLocal();
    local[dateStr] = sales;
    saveLocal(local);
    this.monthCache[dateStr] = sales;
  },

  async remove(dateStr) {
    if (this.mode === 'supabase') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error } = await supabase
        .from('daily_logs')
        .delete()
        .eq('user_id', user.id)
        .eq('log_date', dateStr);
      if (error) throw error;
    }
    const local = loadLocal();
    delete local[dateStr];
    saveLocal(local);
    delete this.monthCache[dateStr];
  }
};

/* ====== DOM ====== */
const elDate        = document.getElementById('date');
const elSales       = document.getElementById('sales');
const elPreview     = document.getElementById('salesPreview');
const elSave        = document.getElementById('saveBtn');
const elClear       = document.getElementById('clearBtn');
const elWeekTotal   = document.getElementById('weekTotal');
const elWeekRange   = document.getElementById('weekRange');
const elMonthTotal  = document.getElementById('monthTotal');
const elMonthLabel  = document.getElementById('monthLabel');
const elMissing     = document.getElementById('missing');
const elSurplusNote = document.getElementById('surplusNote');
const elDaysList    = document.getElementById('daysList');

/* ====== KPIs + List rendering ====== */
async function refreshForSelectedDate() {
  const dateStr  = elDate.value || todayLocalYYYYMMDD();
  const selected = parseYYYYMMDD(dateStr);

  // Hydrate month cache from provider
  await provider.hydrateMonth(selected);

  // Week totals
  const [wStart, wEnd] = weekBounds(selected);
  const weekLogs = await provider.listBetween(wStart, wEnd);
  const weekSum = weekLogs.reduce((a, r) => a + r.sales, 0);
  elWeekTotal.textContent = fmtCOP(weekSum);
  elWeekRange.textContent = `${wStart.toLocaleDateString('en-CA')} → ${wEnd.toLocaleDateString('en-CA')}`;

  // Month totals
  const mStart = startOfMonth(selected);
  const mEnd   = endOfMonth(selected);
  const monthLogs = await provider.listBetween(mStart, mEnd);
  const monthSum = monthLogs.reduce((a, r) => a + r.sales, 0);
  elMonthTotal.textContent = fmtCOP(monthSum);
  elMonthLabel.textContent = selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Monthly target (fixed)
  const target  = 30000000; // COP
  const missing = Math.max(0, target - monthSum);
  elMissing.textContent = fmtCOP(missing);
  elSurplusNote.textContent = monthSum > target ? `Goal reached. Surplus: ${fmtCOP(monthSum - target)}` : '';

  // Month list
  renderMonthList(selected, provider.monthCache);

  // Input hydration for the selected day
  const existing = provider.monthCache[dateStr];
  elSales.value = existing != null ? Number(existing) : '';
  elPreview.textContent = `Formatted: ${fmtCOP(elSales.value || 0)}`;
}

function renderMonthList(selected, store) {
  const mKey = yearMonthKey(selected);
  const items = Object.entries(store)
    .filter(([k]) => yearMonthKey(parseYYYYMMDD(k)) === mKey)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  elDaysList.innerHTML = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = '<small>No entries yet for this month.</small>';
    elDaysList.appendChild(li);
    return;
  }

  for (const [k, v] of items) {
    const li = document.createElement('li');
    li.className = 'item';

    const left = document.createElement('div');
    left.innerHTML = `<strong>${k}</strong><br><small>${fmtCOP(v)}</small>`;

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '10px';

    const editBtn = document.createElement('button');
    editBtn.className = 'link';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => {
      elDate.value = k;
      elSales.value = Number(v);
      elSales.dispatchEvent(new Event('input'));
      refreshForSelectedDate();
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'link';
    delBtn.textContent = 'Delete';
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

/* ====== Events ====== */
elSales.addEventListener('input', () => {
  elPreview.textContent = `Formatted: ${fmtCOP(elSales.value || 0)}`;
});

elDate.addEventListener('change', () => {
  refreshForSelectedDate();
});

elSave.addEventListener('click', async () => {
  const dateStr = elDate.value;
  const amt = Math.round(Number(elSales.value));
  if (!dateStr) { alert('Please select a date.'); elDate.focus(); return; }
  if (!(amt >= 0)) { alert('Please enter a valid non-negative amount.'); elSales.focus(); return; }
  await provider.upsert(dateStr, amt);
  await refreshForSelectedDate();
});

elClear.addEventListener('click', async () => {
  if (provider.mode === 'supabase') {
    // In cloud mode, don't mass-delete remote history from a single button.
    if (confirm('Clear local cache only? (Your cloud data stays intact)')) {
      localStorage.removeItem(LOCAL_KEY);
      await refreshForSelectedDate();
    }
  } else {
    if (confirm('This will remove ALL saved data in this browser. Continue?')) {
      localStorage.removeItem(LOCAL_KEY);
      await refreshForSelectedDate();
    }
  }
});
