/* ============================================================
   Voltage — calculation module (pure functions, no DOM)
   Motor wattage is intentionally absent from every formula.
   ============================================================ */

const Calc = {
  clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
  },

  // Full-charge battery-side kWh for the estimation modes.
  fullBatteryKWh(settings) {
    if (settings.mode === "charger") {
      // Charger label gives wall-side energy; battery side = wall * efficiency
      const wall = (settings.chargerV * settings.chargerA * settings.chargerH) / 1000;
      return wall * (settings.eff / 100);
    }
    return (settings.v * settings.ah) / 1000;
  },

  fullWallKWh(settings) {
    if (settings.mode === "charger") {
      return (settings.chargerV * settings.chargerA * settings.chargerH) / 1000;
    }
    return this.fullBatteryKWh(settings) / (settings.eff / 100);
  },

  // One charging session. Returns wall units, battery energy, loss, estimated flag.
  session(settings, fromPct, toPct, measuredKWh) {
    const eff = this.clamp(settings.eff, 50, 100) / 100;
    if (settings.mode === "measured") {
      const units = Math.max(0, measuredKWh || 0);
      const battery = units * eff;
      return { units, battery, loss: units - battery, estimated: false };
    }
    const from = this.clamp(fromPct, 0, 100);
    const to = this.clamp(toPct, 0, 100);
    const fraction = Math.max(to - from, 0) / 100;
    const units = this.fullWallKWh(settings) * fraction;
    const battery = this.fullBatteryKWh(settings) * fraction;
    return { units, battery, loss: units - battery, estimated: true };
  },

  fullChargeCost(settings, rate) {
    return this.fullWallKWh(settings) * Math.max(0, rate || 0);
  },

  // Hostel bill split at the marginal rate.
  billSplit(totalBill, totalUnits, residents, marginalRate, myScootyUnits) {
    totalBill = Math.max(0, totalBill || 0);
    residents = Math.max(1, Math.floor(residents || 1));
    marginalRate = Math.max(0, marginalRate || 0);
    myScootyUnits = Math.max(0, myScootyUnits || 0);
    const myScootyCost = myScootyUnits * marginalRate;
    const remainingBill = totalBill - myScootyCost;
    const perResident = remainingBill / residents;
    const myTotalShare = perResident + myScootyCost;
    const avgRate = totalUnits > 0 ? totalBill / totalUnits : 0;
    return { myScootyCost, remainingBill, perResident, myTotalShare, avgRate };
  },

  // Petrol price in effect on a date (newest price whose date <= given date).
  priceOn(history, dateStr) {
    let best = null;
    for (const p of history) {
      if (p.date <= dateStr && (!best || p.date > best.date)) best = p;
    }
    return best ? best.price : null;
  },

  // Savings across charges that have km recorded.
  savings(charges, priceHistory, mileage) {
    mileage = Math.max(0.1, mileage || 45);
    let petrol = 0, elec = 0, km = 0, counted = 0, excluded = 0;
    const perMonth = {};
    for (const c of charges) {
      if (!(c.km > 0)) { excluded++; continue; }
      const price = this.priceOn(priceHistory, c.date.slice(0, 10));
      if (price == null) { excluded++; continue; }
      const pCost = (c.km / mileage) * price;
      petrol += pCost; elec += c.cost; km += c.km; counted++;
      const m = c.date.slice(0, 7);
      if (!perMonth[m]) perMonth[m] = { petrol: 0, elec: 0, km: 0 };
      perMonth[m].petrol += pCost;
      perMonth[m].elec += c.cost;
      perMonth[m].km += c.km;
    }
    return {
      petrol, elec, net: petrol - elec, km, counted, excluded, perMonth,
      elecPer100: km > 0 ? (elec / km) * 100 : null,
      petrolPer100: km > 0 ? (petrol / km) * 100 : null,
    };
  },
};

if (typeof module !== "undefined") { module.exports = Calc; }
if (typeof document === "undefined") { /* node test run — stop before DOM code */ }
else {

/* ============================================================
   State + persistence
   ============================================================ */

const STORE_KEY = "voltage.v1";

const defaultState = () => ({
  settings: {
    v: 60, ah: 20, eff: 87, motor: 1200, range: 60,
    mode: "battery", chargerV: 67.2, chargerA: 3.5, chargerH: 6,
  },
  currentPct: 20,
  charges: [],            // {id, date ISO, from, to, units, cost, km, estimated}
  bills: {},              // "2026-09": {totalBill, totalUnits, residents, rate}
  lastRate: 8,
  petrolPrices: [],       // {date "YYYY-MM-DD", price}
  mileage: 45,
  theme: null,
});

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* corrupted or unavailable storage — start fresh */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
}

const $ = (id) => document.getElementById(id);
const fmt = (n, dp = 2) => (n == null || !isFinite(n)) ? "–" : n.toFixed(dp);
const rs = (n) => fmt(n, 2);

/* ============================================================
   Theme
   ============================================================ */

function applyTheme() {
  const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const t = S.theme || sys;
  document.documentElement.setAttribute("data-theme", t);
}
$("themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  S.theme = cur === "dark" ? "light" : "dark";
  save(); applyTheme();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
applyTheme();

/* ============================================================
   Read-only share view
   ============================================================ */

function tryShareView() {
  if (!location.hash.startsWith("#s=")) return false;
  try {
    const d = JSON.parse(atob(decodeURIComponent(location.hash.slice(3))));
    $("appView").hidden = true;
    $("shareView").hidden = false;
    $("shMonth").textContent = d.m;
    $("shUnits").textContent = fmt(d.u) + " kWh";
    $("shRate").textContent = rs(d.r) + " Rs/kWh";
    $("shCost").textContent = rs(d.c) + " Rs";
    $("shRemaining").textContent = rs(d.b) + " Rs";
    $("shPer").textContent = rs(d.p) + " Rs";
    $("shTotal").textContent = rs(d.t);
    $("shNote").textContent = d.e
      ? "Scooty units are estimated from battery specs, not a meter."
      : "Scooty units are measured with a plug-in energy meter.";
    return true;
  } catch (e) { return false; }
}
if (tryShareView()) { /* read-only page: nothing else runs */ }
else {

/* ============================================================
   Tabs
   ============================================================ */

const panels = ["charge", "log", "bill", "saved", "settings"];
function showTab(name) {
  panels.forEach((p) => { $("tab-" + p).hidden = p !== name; });
  document.querySelectorAll(".tabs [role=tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  });
  if (name === "bill") renderBill();
  if (name === "saved") renderSaved();
  if (name === "log") renderLog();
}
document.querySelectorAll(".tabs [role=tab]").forEach((b) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
});
$("chShowLog").addEventListener("click", () => showTab("log"));
$("logBack").addEventListener("click", () => showTab("charge"));

/* ============================================================
   Settings tab
   ============================================================ */

function bindSetting(id, key, lo, hi) {
  const el = $(id);
  el.value = S.settings[key];
  el.addEventListener("input", () => {
    let v = parseFloat(el.value);
    if (isFinite(v)) {
      if (lo != null) v = Calc.clamp(v, lo, hi);
      S.settings[key] = v;
      save(); renderCharge();
    }
  });
  el.addEventListener("blur", () => { el.value = S.settings[key]; });
}
bindSetting("stV", "v", 1, 1000);
bindSetting("stAh", "ah", 0.1, 1000);
bindSetting("stEff", "eff", 50, 100);
bindSetting("stMotor", "motor", 0, 100000);
bindSetting("stRange", "range", 1, 10000);
bindSetting("stChV", "chargerV", 1, 1000);
bindSetting("stChA", "chargerA", 0.1, 100);
bindSetting("stChH", "chargerH", 0.1, 48);

document.querySelectorAll("input[name=mode]").forEach((r) => {
  r.checked = r.value === S.settings.mode;
  r.addEventListener("change", () => {
    if (r.checked) {
      S.settings.mode = r.value;
      save(); syncModeUI(); renderCharge();
    }
  });
});
function syncModeUI() {
  $("stChargerWrap").hidden = S.settings.mode !== "charger";
  $("chMeasuredWrap").hidden = S.settings.mode !== "measured";
}
syncModeUI();

$("stWipe").addEventListener("click", () => {
  if (confirm("Delete ALL Voltage data on this device? This cannot be undone.")) {
    localStorage.removeItem(STORE_KEY);
    location.reload();
  }
});

/* ============================================================
   Charge tab
   ============================================================ */

$("chFrom").value = S.currentPct;
$("chTo").value = 100;

function chargeInputs() {
  return {
    from: Calc.clamp(parseFloat($("chFrom").value), 0, 100),
    to: Calc.clamp(parseFloat($("chTo").value), 0, 100),
    km: parseFloat($("chKm").value),
    measured: parseFloat($("chMeasured").value),
  };
}

function renderCharge() {
  const { from, to, measured } = chargeInputs();
  const warn = $("chWarn");
  warn.hidden = true;
  if (S.settings.mode !== "measured" && to <= from) {
    warn.textContent = "Target % must be higher than current %.";
    warn.hidden = false;
  }
  const sess = Calc.session(S.settings, from, to, measured);
  const rate = S.lastRate || 0;
  $("chUnits").textContent = fmt(sess.units);
  $("chCost").textContent = rs(sess.units * rate);
  $("chRateEcho").textContent = fmt(rate);
  $("chBattery").textContent = fmt(sess.battery) + " kWh";
  $("chLoss").textContent = fmt(sess.loss) + " kWh";
  $("chFullCost").textContent = rs(Calc.fullChargeCost(S.settings, rate)) + " Rs";
  $("chEstBadge").hidden = !sess.estimated;
}
["chFrom", "chTo", "chKm", "chMeasured"].forEach((id) =>
  $(id).addEventListener("input", renderCharge));

$("chSave").addEventListener("click", () => {
  const { from, to, km, measured } = chargeInputs();
  if (S.settings.mode === "measured" && !(measured > 0)) {
    alert("Enter the meter reading (kWh) for this charge."); return;
  }
  if (S.settings.mode !== "measured" && to <= from) {
    alert("Target % must be higher than current %."); return;
  }
  const sess = Calc.session(S.settings, from, to, measured);
  S.charges.push({
    id: Date.now(),
    date: new Date().toISOString(),
    from, to,
    units: sess.units,
    cost: sess.units * (S.lastRate || 0),
    km: km > 0 ? km : null,
    estimated: sess.estimated,
  });
  S.currentPct = to;
  save();
  $("chFrom").value = to;
  $("chKm").value = "";
  $("chMeasured").value = "";
  renderCharge();
  showTab("log");
});

/* ============================================================
   Log
   ============================================================ */

function chargesByMonth() {
  const groups = {};
  for (const c of S.charges) {
    const m = c.date.slice(0, 7);
    (groups[m] = groups[m] || []).push(c);
  }
  return Object.keys(groups).sort().reverse().map((m) => [m, groups[m]]);
}

function renderLog() {
  const host = $("logList");
  host.innerHTML = "";
  if (!S.charges.length) {
    host.innerHTML = '<p class="quiet">No charges saved yet.</p>'; return;
  }
  for (const [month, rows] of chargesByMonth()) {
    const h = document.createElement("p");
    h.className = "month-head";
    h.textContent = month;
    host.appendChild(h);
    const t = document.createElement("table");
    t.innerHTML = "<tr><th>Date</th><th>%→%</th><th>kWh</th><th>Rs</th><th>km</th><th></th></tr>";
    for (const c of rows.slice().reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${c.date.slice(0, 10)}</td>` +
        `<td>${c.from}→${c.to}</td>` +
        `<td>${fmt(c.units)}${c.estimated ? "*" : ""}</td>` +
        `<td>${rs(c.cost)}</td>` +
        `<td>${c.km != null ? fmt(c.km, 1) : "–"}</td>` +
        `<td></td>`;
      const cell = tr.lastElementChild;
      const edit = document.createElement("button");
      edit.className = "row-btn"; edit.textContent = "Edit";
      edit.addEventListener("click", () => editCharge(c));
      const del = document.createElement("button");
      del.className = "row-btn"; del.textContent = "✕";
      del.setAttribute("aria-label", "Delete entry");
      del.addEventListener("click", () => {
        if (confirm("Delete this charge entry?")) {
          S.charges = S.charges.filter((x) => x.id !== c.id);
          save(); renderLog();
        }
      });
      cell.append(edit, del);
      t.appendChild(tr);
    }
    host.appendChild(t);
  }
  const note = document.createElement("p");
  note.className = "quiet";
  note.textContent = "* estimated from battery specs, not a meter reading";
  host.appendChild(note);
}

function editCharge(c) {
  const units = parseFloat(prompt("Units (kWh):", fmt(c.units)));
  if (!isFinite(units) || units < 0) return;
  const cost = parseFloat(prompt("Cost (Rs):", fmt(c.cost)));
  if (!isFinite(cost) || cost < 0) return;
  const kmRaw = prompt("Distance (km, blank for none):", c.km != null ? fmt(c.km, 1) : "");
  const km = parseFloat(kmRaw);
  c.units = units; c.cost = cost; c.km = km > 0 ? km : null;
  save(); renderLog();
}

$("logExport").addEventListener("click", () => {
  const lines = ["date,from_pct,to_pct,units_kwh,cost_rs,km,estimated"];
  for (const c of S.charges) {
    lines.push([c.date, c.from, c.to, fmt(c.units), rs(c.cost),
      c.km != null ? fmt(c.km, 1) : "", c.estimated ? "yes" : "no"].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "voltage-charges.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ============================================================
   Bill tab
   ============================================================ */

const thisMonth = new Date().toISOString().slice(0, 7);
$("blMonth").value = thisMonth;

function billMonth() { return $("blMonth").value || thisMonth; }

function monthScooty(month) {
  let units = 0, anyEstimated = false;
  for (const c of S.charges) {
    if (c.date.slice(0, 7) === month) {
      units += c.units;
      if (c.estimated) anyEstimated = true;
    }
  }
  return { units, anyEstimated };
}

function loadBillInputs() {
  const b = S.bills[billMonth()] || {};
  $("blTotal").value = b.totalBill ?? "";
  $("blUnits").value = b.totalUnits ?? "";
  $("blResidents").value = b.residents ?? "";
  $("blRate").value = b.rate ?? S.lastRate ?? "";
}

function billValues() {
  return {
    totalBill: Math.max(0, parseFloat($("blTotal").value) || 0),
    totalUnits: Math.max(0, parseFloat($("blUnits").value) || 0),
    residents: Math.max(1, parseInt($("blResidents").value) || 1),
    rate: Math.max(0, parseFloat($("blRate").value) || 0),
  };
}

function renderBill() {
  const month = billMonth();
  const v = billValues();
  const { units, anyEstimated } = monthScooty(month);
  const r = Calc.billSplit(v.totalBill, v.totalUnits, v.residents, v.rate, units);

  $("blMyUnits").textContent = fmt(units) + " kWh";
  $("blMyCost").textContent = rs(r.myScootyCost) + " Rs";
  $("blRemaining").textContent = rs(r.remainingBill) + " Rs";
  $("blPer").textContent = rs(r.perResident) + " Rs";
  $("blMyShare").textContent = rs(r.myTotalShare);
  $("blAvgRate").textContent = v.totalUnits > 0 ? fmt(r.avgRate) + " Rs/kWh" : "–";
  $("blRateEcho").textContent = fmt(v.rate);
  $("blEstBadge").hidden = !anyEstimated;

  const warn = $("blWarn");
  const msgs = [];
  if (v.totalUnits > 0 && units > v.totalUnits)
    msgs.push("Your scooty units exceed the whole bill's units — check the inputs.");
  if (v.totalUnits > 0 && v.rate > 0 && v.rate < r.avgRate)
    msgs.push("Marginal rate is below the bill's average rate — that is usually wrong; the top slab should cost more than the average.");
  warn.textContent = msgs.join(" ");
  warn.hidden = !msgs.length;
}

["blTotal", "blUnits", "blResidents", "blRate"].forEach((id) =>
  $(id).addEventListener("input", () => {
    const v = billValues();
    if (v.rate > 0) { S.lastRate = v.rate; save(); }
    renderBill();
  }));
$("blMonth").addEventListener("change", () => { loadBillInputs(); renderBill(); });

$("blSave").addEventListener("click", () => {
  const v = billValues();
  S.bills[billMonth()] = { totalBill: v.totalBill, totalUnits: v.totalUnits, residents: v.residents, rate: v.rate };
  S.lastRate = v.rate;
  save(); renderBill();
  $("blShareMsg").textContent = "Saved.";
  $("blShareMsg").hidden = false;
});

function billPayload() {
  const month = billMonth();
  const v = billValues();
  const { units, anyEstimated } = monthScooty(month);
  const r = Calc.billSplit(v.totalBill, v.totalUnits, v.residents, v.rate, units);
  return { m: month, u: +units.toFixed(2), r: v.rate, c: +r.myScootyCost.toFixed(2),
           b: +r.remainingBill.toFixed(2), p: +r.perResident.toFixed(2),
           t: +r.myTotalShare.toFixed(2), e: anyEstimated };
}

$("blShare").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#s=" +
    encodeURIComponent(btoa(JSON.stringify(billPayload())));
  const msg = $("blShareMsg");
  try {
    await navigator.clipboard.writeText(url);
    msg.textContent = "Share link copied to clipboard.";
  } catch (e) {
    msg.textContent = url;
  }
  msg.hidden = false;
});

$("blCopy").addEventListener("click", async () => {
  const d = billPayload();
  const text =
    `Hostel electricity split — ${d.m}\n` +
    `My scooty used ${fmt(d.u)} kWh (${d.e ? "estimated" : "meter-measured"})\n` +
    `Charged at the top-slab rate of ${fmt(d.r)} Rs/kWh = ${rs(d.c)} Rs\n` +
    `Remaining bill ${rs(d.b)} Rs ÷ residents = ${rs(d.p)} Rs each\n` +
    `My total share: ${rs(d.t)} Rs`;
  const msg = $("blShareMsg");
  try {
    await navigator.clipboard.writeText(text);
    msg.textContent = "Summary text copied.";
  } catch (e) {
    msg.textContent = text;
  }
  msg.hidden = false;
});

loadBillInputs();

/* ============================================================
   Saved tab
   ============================================================ */

$("svMileage").value = S.mileage;
$("svMileage").addEventListener("input", () => {
  const v = parseFloat($("svMileage").value);
  if (v > 0) { S.mileage = v; save(); renderSaved(); }
});
$("ppDate").value = new Date().toISOString().slice(0, 10);

$("ppAdd").addEventListener("click", () => {
  const date = $("ppDate").value;
  const price = parseFloat($("ppPrice").value);
  if (!date || !(price > 0)) { alert("Enter a date and a positive price."); return; }
  S.petrolPrices = S.petrolPrices.filter((p) => p.date !== date);
  S.petrolPrices.push({ date, price });
  S.petrolPrices.sort((a, b) => a.date < b.date ? -1 : 1);
  $("ppPrice").value = "";
  save(); renderSaved();
});

function renderSaved() {
  const s = Calc.savings(S.charges, S.petrolPrices, S.mileage);
  $("svNet").textContent = rs(s.net);
  $("svPetrol").textContent = rs(s.petrol) + " Rs";
  $("svElec").textContent = rs(s.elec) + " Rs";
  $("svE100").textContent = s.elecPer100 != null ? rs(s.elecPer100) + " Rs/100 km" : "–";
  $("svP100").textContent = s.petrolPer100 != null ? rs(s.petrolPer100) + " Rs/100 km" : "–";
  const ex = $("svExcluded");
  ex.hidden = s.excluded === 0;
  ex.textContent = s.excluded + " charge(s) excluded — no distance recorded or no petrol price covers their date.";

  const mh = $("svMonths");
  mh.innerHTML = "";
  const months = Object.keys(s.perMonth).sort().reverse();
  if (!months.length) {
    mh.innerHTML = '<p class="quiet">No charges with distance recorded yet.</p>';
  } else {
    const t = document.createElement("table");
    t.innerHTML = "<tr><th>Month</th><th>km</th><th>Petrol Rs</th><th>Electric Rs</th><th>Saved Rs</th></tr>";
    for (const m of months) {
      const d = s.perMonth[m];
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m}</td><td>${fmt(d.km, 1)}</td><td>${rs(d.petrol)}</td><td>${rs(d.elec)}</td><td>${rs(d.petrol - d.elec)}</td>`;
      t.appendChild(tr);
    }
    mh.appendChild(t);
  }

  const ph = $("ppList");
  ph.innerHTML = "";
  if (S.petrolPrices.length) {
    const t = document.createElement("table");
    t.innerHTML = "<tr><th>From date</th><th>Rs/L</th><th></th></tr>";
    for (const p of S.petrolPrices.slice().reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.date}</td><td>${rs(p.price)}</td><td></td>`;
      const del = document.createElement("button");
      del.className = "row-btn"; del.textContent = "✕";
      del.setAttribute("aria-label", "Delete price");
      del.addEventListener("click", () => {
        S.petrolPrices = S.petrolPrices.filter((x) => x.date !== p.date);
        save(); renderSaved();
      });
      tr.lastElementChild.appendChild(del);
      t.appendChild(tr);
    }
    ph.appendChild(t);
  } else {
    ph.innerHTML = '<p class="quiet">No petrol prices yet — add one to compute savings.</p>';
  }
}

/* ============================================================
   Boot
   ============================================================ */

renderCharge();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

} // end app (non-share) branch
} // end browser branch
