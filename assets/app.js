// CARPADS Client Garage — web app (no build step; plain ES modules).
import { createBackend, isDemo } from "./data.js";
import { COMPANY } from "./config.js";

const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $toast = document.getElementById("toast");

const state = {
  backend: null,
  profile: null,
  collapsed: { stored: false, retrieved: false },
  installPrompt: null,
};

// ───────────────────────── helpers ─────────────────────────

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

const swissDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d) ? "" : new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};
const dayName = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? "" : new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d);
};
const swissNumber = (n) => Number(n || 0).toLocaleString("de-CH");
const isoDay = (date) => date.toISOString().slice(0, 10);

function conditionColor(v) {
  if (v >= 90) return "var(--excellent)";
  if (v >= 70) return "var(--good)";
  if (v >= 40) return "var(--fair)";
  return "var(--poor)";
}

const KINDS = {
  delivery: { label: "Delivery", verb: "Schedule delivery", hint: "We bring your car to you.", logistics: true },
  pickup: { label: "Pickup", verb: "Schedule pickup", hint: "We collect your car and bring it back into storage.", logistics: true },
  service: { label: "Service", verb: "Book service", hint: "Workshop service while your car is with us." },
  detailing: { label: "Detailing", verb: "Book detailing", hint: "Professional cleaning and care." },
  other: { label: "Other", verb: "Other request", hint: "Anything else we can do for you." },
};
const TIME_WINDOWS = { morning: "Morning (8–12)", afternoon: "Afternoon (12–17)", evening: "Evening (17–20)" };

// Stored cars can be delivered to the client; retrieved cars can be picked up.
const kindsFor = (car) => car.status === "stored"
  ? ["delivery", "service", "detailing", "other"]
  : ["pickup", "service", "detailing", "other"];
const logisticsKind = (car) => (car.status === "stored" ? "delivery" : "pickup");

function toast(message) {
  $toast.textContent = message;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), 3200);
}

function openModal(html, onReady) {
  $modal.innerHTML = html;
  $modal.showModal();
  $modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => $modal.close()));
  onReady?.($modal);
}
$modal.addEventListener("click", (e) => { if (e.target === $modal) $modal.close(); });

async function run(button, fn) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "…"; }
  try { return await fn(); }
  catch (err) { toast(err.message || "Something went wrong."); throw err; }
  finally { if (button) { button.disabled = false; button.textContent = label; } }
}

// ───────────────────────── components ─────────────────────────

function ring(value, label, size = 64) {
  const v = clamp(value);
  const r = 27;
  const c = 2 * Math.PI * r;
  return `
    <figure class="ring" style="--size:${size}px" aria-label="${esc(label)} ${v} percent">
      <div class="ring-dial">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="${r}" class="ring-track"/>
          <circle cx="32" cy="32" r="${r}" class="ring-value" style="stroke:${conditionColor(v)}"
            stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 32 32)"/>
        </svg>
        <span class="ring-num">${v} %</span>
      </div>
      <figcaption>${esc(label)}</figcaption>
    </figure>`;
}

const rings = (car, size) => `<div class="rings">
  ${ring(car.interior, "Interior", size)}${ring(car.exterior, "Exterior", size)}
  ${ring(car.battery, "Battery", size)}${ring(car.service, "Service", size)}</div>`;

function facts(car, withLocation = false) {
  const row = (label, value) => (value ? `<div><span>${label}:</span> ${esc(value)}</div>` : "");
  return `<div class="facts">
    ${row("Plate", car.plate)}
    ${row("Insurance", car.insurance)}
    ${row("Policy number", car.policy_number)}
    ${row("Mileage", `${swissNumber(car.mileage_km)} km`)}
    ${car.fuel_level != null ? row("Fuel level", `${car.fuel_level}%`) : ""}
    ${row("Last check-in/out", swissDate(car.last_check_at))}
    ${withLocation ? row("Location", car.location_name) : ""}
  </div>`;
}

const alertBadge = (car) => car.action_alert
  ? `<button class="alert-badge" data-action="request" data-car="${car.id}" data-kind="${/detail/i.test(car.action_alert) ? "detailing" : "service"}">
       <span class="alert-dot" aria-hidden="true">!</span>${esc(car.action_alert)}</button>`
  : "";

function requestChip(req) {
  const k = KINDS[req.kind]?.label || req.kind;
  const when = req.preferred_date ? ` · ${dayName(req.preferred_date)} ${swissDate(req.preferred_date)}` : "";
  const win = req.time_window ? ` · ${TIME_WINDOWS[req.time_window].split(" ")[0]}` : "";
  return `<div class="chip">${esc(k)} requested${esc(when)}${esc(win)}</div>`;
}

function footer() {
  return `<footer class="company">
    <div class="company-name">${COMPANY.name}</div>
    <div class="company-links">
      <a href="${COMPANY.phoneHref}">${COMPANY.phone}</a>
      <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>
      <a href="${COMPANY.websiteHref}" target="_blank" rel="noopener">${COMPANY.website}</a>
    </div>
  </footer>`;
}

function topbar(title, { back, admin } = {}) {
  return `<header class="topbar">
    <div class="topbar-side">${back ? `<a class="icon-btn" href="${back}" aria-label="Back">‹</a>` : `<span class="mini-mark">CARPADS</span>`}</div>
    <h1 class="topbar-title">${esc(title)}</h1>
    <div class="topbar-side right">
      <button class="icon-btn" data-action="account" aria-label="Account">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3.2"/><path d="M5.5 18.5c1.6-2.3 3.9-3.4 6.5-3.4s4.9 1.1 6.5 3.4"/>
        </svg>${admin ? `<span class="admin-tag">Admin</span>` : ""}</button>
    </div>
  </header>`;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function installBanner() {
  if (isStandalone()) return "";
  let dismissed = false;
  try { dismissed = localStorage.getItem("carpads-install-dismissed") === "1"; } catch { /* ignore */ }
  if (dismissed) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const body = state.installPrompt
    ? `<button class="btn small" data-action="install">Install app</button>`
    : ios
      ? `Tap <strong>Share</strong> <span aria-hidden="true">⎋</span> then <strong>Add to Home Screen</strong>.`
      : `Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.`;
  return `<aside class="install">
    <div><strong>Get the CARPADS app</strong><br>${body}</div>
    <button class="icon-btn" data-action="dismiss-install" aria-label="Dismiss">×</button>
  </aside>`;
}

// ───────────────────────── views: login ─────────────────────────

function viewLogin() {
  document.title = "Client Garage | CARPADS Private Car Storage";
  $app.innerHTML = `
    <main class="login">
      <div class="brand">
        <h1 class="wordmark">CARPADS</h1>
        <p class="tagline">Client Garage</p>
      </div>
      <form id="login-form" class="stack" autocomplete="on">
        <label class="field"><span>Email</span>
          <input name="email" type="email" autocomplete="username" required inputmode="email"></label>
        <label class="field"><span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error" id="login-error" hidden></p>
        <button class="btn primary" type="submit">Sign in</button>
        <button class="link" type="button" id="forgot">Forgot password?</button>
      </form>
      ${isDemo ? `<p class="demo-note">Demo mode<br>Client: demo@carpads.ch / demo<br>Admin: admin@carpads.ch / admin</p>` : ""}
      <p class="intro">Your cars in storage at a glance: condition, location and service status, with delivery and pickup in a tap.</p>
      ${footer()}
    </main>`;

  document.getElementById("forgot").addEventListener("click", () => forgotDialog(
    document.querySelector('#login-form input[name="email"]').value.trim()));

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = document.getElementById("login-error");
    err.hidden = true;
    try {
      state.profile = await run(e.target.querySelector("button"), () =>
        state.backend.signIn(String(f.get("email")).trim().toLowerCase(), String(f.get("password"))));
      location.hash = state.profile.role === "admin" ? "#admin" : "#garage";
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

function forgotDialog(email) {
  openModal(`
    <form class="sheet">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>Reset password</h2><span></span></header>
      <p class="muted">Enter your email. We'll send you a link to choose a new password.</p>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
      <button class="btn primary" type="submit">Send link</button>
      <small class="muted">No email? Contact CARPADS at ${COMPANY.phone} and we'll set a new password for you.</small>
    </form>`, (dlg) => {
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const addr = String(new FormData(e.target).get("email")).trim().toLowerCase();
      await run(e.target.querySelector('[type="submit"]'), () => state.backend.resetPassword(addr));
      $modal.close();
      toast("Check your email for the reset link.");
    });
  });
}

function newPasswordDialog() {
  openModal(`
    <form class="sheet">
      <header class="sheet-head"><span></span><h2>Choose a new password</h2><span></span></header>
      <label class="field"><span>New password</span><input type="password" name="pw" minlength="8" autocomplete="new-password" required></label>
      <label class="field"><span>Repeat password</span><input type="password" name="pw2" minlength="8" autocomplete="new-password" required></label>
      <button class="btn primary" type="submit">Save password</button>
    </form>`, (dlg) => {
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get("pw") !== f.get("pw2")) { toast("The passwords don't match."); return; }
      await run(e.target.querySelector('[type="submit"]'), () => state.backend.changePassword(String(f.get("pw"))));
      $modal.close();
      toast("Password saved.");
    });
  });
}

// ───────────────────────── views: client ─────────────────────────

async function viewGarage() {
  document.title = "My Garage | CARPADS";
  $app.innerHTML = `${topbar("My Garage")}<main class="page"><div class="loading">Loading your garage…</div></main>`;
  const [cars, requests] = await Promise.all([state.backend.myCars(), state.backend.myRequests()]);
  state.cars = cars;
  const openFor = (car) => requests.filter((r) => r.car_id === car.id);

  const section = (status, title) => {
    const list = cars.filter((c) => c.status === status);
    const open = !state.collapsed[status];
    return `<section class="garage-section">
      <button class="section-head" data-action="toggle" data-status="${status}" aria-expanded="${open}">
        <h2>${title} <small>${list.length}</small></h2><span class="chevron ${open ? "" : "closed"}" aria-hidden="true"></span>
      </button>
      ${open ? (list.length ? list.map((car) => carCard(car, openFor(car))).join("")
        : `<p class="empty">${status === "stored" ? "No cars in storage right now." : "No cars currently with you."}</p>`) : ""}
    </section>`;
  };

  $app.querySelector("main").innerHTML = `
    ${installBanner()}
    ${state.profile.full_name ? `<p class="welcome">Welcome, ${esc(state.profile.full_name)}</p>` : ""}
    ${section("stored", "Stored")}
    ${section("retrieved", "Retrieved")}
    ${footer()}`;
}

function carCard(car, requests) {
  const kind = logisticsKind(car);
  return `<article class="car-card">
    <div class="car-main">
      <div class="car-head">
        <h3><a href="#car-${car.id}">${esc(car.make_model)}</a></h3>
        ${alertBadge(car)}
      </div>
      ${requests.map(requestChip).join("")}
      ${facts(car)}
    </div>
    <a class="car-rings" href="#car-${car.id}" aria-label="Details for ${esc(car.make_model)}">${rings(car)}</a>
    <div class="car-actions">
      <button class="btn outline" data-action="request" data-car="${car.id}" data-kind="${kind}">${KINDS[kind].verb}</button>
      <a class="btn ghost" href="#car-${car.id}">Details</a>
    </div>
  </article>`;
}

async function viewCar(id) {
  if (!state.cars) state.cars = await state.backend.myCars();
  const car = state.cars.find((c) => c.id === id);
  if (!car) { location.hash = "#garage"; return; }
  const requests = (await state.backend.myRequests()).filter((r) => r.car_id === car.id);
  document.title = `${car.make_model} | CARPADS`;
  const kind = logisticsKind(car);
  const map = car.latitude != null && car.longitude != null
    ? (() => {
      const d = 0.006;
      const bbox = [car.longitude - d, car.latitude - d / 2, car.longitude + d, car.latitude + d / 2].join(",");
      return `<iframe class="map" title="Map of ${esc(car.location_name || car.make_model)}" loading="lazy"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${car.latitude},${car.longitude}"></iframe>`;
    })()
    : "";

  $app.innerHTML = `${topbar(car.plate || car.make_model, { back: "#garage" })}
    <main class="page detail">
      <span class="pill">${car.status === "stored" ? "Stored" : "Retrieved"}</span>
      <h2 class="detail-title">${esc(car.make_model)}</h2>
      ${alertBadge(car)}
      ${requests.map(requestChip).join("")}
      <div class="rings big">${["interior", "exterior", "battery", "service"]
        .map((k) => ring(car[k], k[0].toUpperCase() + k.slice(1), 104)).join("")}</div>
      <section class="card"><h3 class="card-title">Details</h3>${facts(car)}</section>
      <section class="card"><h3 class="card-title">Location</h3>
        <p>${esc(car.location_name || "Not set")}</p>${map}</section>
      <div class="stack">
        <button class="btn primary" data-action="request" data-car="${car.id}" data-kind="${kind}">${KINDS[kind].verb}</button>
        <button class="btn outline" data-action="request" data-car="${car.id}" data-kind="service">Book service or detailing</button>
        <div class="row">
          <a class="btn ghost" href="${COMPANY.phoneHref}">Call</a>
          <a class="btn ghost" href="mailto:${COMPANY.email}?subject=${encodeURIComponent(car.make_model + " " + (car.plate || ""))}">Email</a>
        </div>
      </div>
      ${footer()}
    </main>`;
}

function requestDialog(car, kind) {
  const tomorrow = new Date(Date.now() + 86400000);
  const options = kindsFor(car).map((k) => `
    <label class="choice"><input type="radio" name="kind" value="${k}" ${k === kind ? "checked" : ""}>
      <span><strong>${KINDS[k].label}</strong><small>${KINDS[k].hint}</small></span></label>`).join("");

  openModal(`
    <form class="sheet" id="request-form">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button>
        <h2>${esc(car.make_model)}</h2><span></span></header>
      <fieldset class="choices"><legend>What do you need?</legend>${options}</fieldset>
      <div id="logistics" class="stack">
        <label class="field"><span>Preferred date</span>
          <input type="date" name="date" min="${isoDay(tomorrow)}" value="${isoDay(tomorrow)}"></label>
        <label class="field"><span>Time</span>
          <select name="window">${Object.entries(TIME_WINDOWS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
        <label class="field"><span id="address-label">Address</span>
          <textarea name="address" rows="2" placeholder="Street, number, postcode, town"></textarea></label>
      </div>
      <label class="field"><span>Message (optional)</span>
        <textarea name="message" rows="3" placeholder="Anything we should know?"></textarea></label>
      <p class="error" hidden></p>
      <button class="btn primary" type="submit">Send request</button>
    </form>`, (dlg) => {
    const form = dlg.querySelector("form");
    const sync = () => {
      const k = form.kind.value;
      const logistics = KINDS[k]?.logistics;
      dlg.querySelector("#logistics").hidden = !logistics;
      form.address.required = !!logistics;
      form.date.required = !!logistics;
      dlg.querySelector("#address-label").textContent = k === "pickup" ? "Pickup address" : "Delivery address";
    };
    form.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const k = f.get("kind");
      const logistics = KINDS[k].logistics;
      await run(form.querySelector("[type=submit]"), () => state.backend.createRequest({
        car, kind: k,
        preferredDate: logistics ? f.get("date") : null,
        timeWindow: logistics ? f.get("window") : null,
        address: logistics ? String(f.get("address")).trim() : null,
        message: String(f.get("message")).trim() || null,
      }));
      $modal.close();
      toast(`${KINDS[k].label} request sent. CARPADS will confirm shortly.`);
      render();
    });
  });
}

function accountDialog() {
  const p = state.profile;
  openModal(`
    <div class="sheet">
      <header class="sheet-head"><span></span><h2>Account</h2><button class="link" data-close>Done</button></header>
      <p class="muted">${esc(p.full_name || "")}<br>${esc(p.email || "")}</p>
      <form id="pw-form" class="stack">
        <label class="field"><span>New password</span>
          <input type="password" name="pw" minlength="8" autocomplete="new-password" required></label>
        <label class="field"><span>Repeat password</span>
          <input type="password" name="pw2" minlength="8" autocomplete="new-password" required></label>
        <button class="btn outline" type="submit">Change password</button>
      </form>
      ${isDemo && p.role === "admin" ? `<button class="btn ghost" data-action-modal="reset-demo">Reset demo data</button>` : ""}
      <button class="btn danger" data-action-modal="signout">Sign out</button>
    </div>`, (dlg) => {
    dlg.querySelector("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get("pw") !== f.get("pw2")) { toast("The passwords don't match."); return; }
      await run(e.target.querySelector("button"), () => state.backend.changePassword(String(f.get("pw"))));
      $modal.close();
      toast("Password changed.");
    });
    dlg.querySelector('[data-action-modal="signout"]').addEventListener("click", async () => {
      await state.backend.signOut();
      state.profile = null;
      state.cars = null;
      $modal.close();
      location.hash = "";
      render();
    });
    dlg.querySelector('[data-action-modal="reset-demo"]')?.addEventListener("click", () => {
      state.backend.reset();
      $modal.close();
      toast("Demo data reset.");
      render();
    });
  });
}

// ───────────────────────── views: admin ─────────────────────────

function adminTabs(active) {
  return `<nav class="tabs">
    <a href="#admin" class="${active === "clients" ? "active" : ""}">Clients</a>
    <a href="#requests" class="${active === "requests" ? "active" : ""}">Requests</a>
  </nav>`;
}

async function viewAdminClients() {
  document.title = "Clients | CARPADS Manager";
  $app.innerHTML = `${topbar("Manager", { admin: true })}${adminTabs("clients")}
    <main class="page"><div class="loading">Loading clients…</div></main>`;
  const clients = await state.backend.clients();
  const main = $app.querySelector("main");
  main.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search clients" aria-label="Search clients">
      <button class="btn primary small" data-action="new-client">+ Client</button>
    </div>
    <ul class="list" id="client-list"></ul>`;
  const list = main.querySelector("#client-list");
  const draw = (q = "") => {
    const ql = q.toLowerCase();
    const shown = clients.filter((c) => !ql || `${c.full_name} ${c.email}`.toLowerCase().includes(ql));
    list.innerHTML = shown.length
      ? shown.map((c) => `<li><a href="#client-${c.id}">
          <strong>${esc(c.full_name || c.email)}</strong><small>${esc(c.email || "")}</small></a></li>`).join("")
      : `<li class="empty">${clients.length ? "No matching clients." : "No clients yet. Add your first client."}</li>`;
  };
  draw();
  main.querySelector("#search").addEventListener("input", (e) => draw(e.target.value));
}

async function viewAdminClient(id) {
  const clients = await state.backend.clients();
  const client = clients.find((c) => c.id === id);
  if (!client) { location.hash = "#admin"; return; }
  document.title = `${client.full_name || client.email} | CARPADS Manager`;
  const cars = await state.backend.carsFor(id);
  state.adminCars = cars;
  state.adminClient = client;
  const dots = (car) => ["interior", "exterior", "battery", "service"]
    .map((k) => `<i style="background:${conditionColor(clamp(car[k]))}"></i>`).join("");

  $app.innerHTML = `${topbar(client.full_name || client.email, { back: "#admin", admin: true })}
    <main class="page">
      <section class="card">
        <h3 class="card-title">Contact</h3>
        <div class="facts"><div><span>Email:</span> ${esc(client.email || "–")}</div>
          <div><span>Phone:</span> ${esc(client.phone || "–")}</div></div>
        <div class="row">
          <button class="btn ghost small" data-action="edit-client">Edit contact</button>
          ${state.backend.resetClientPassword ? `<button class="btn ghost small" data-action="reset-client-pw">New password</button>` : ""}
        </div>
      </section>
      <section class="card">
        <h3 class="card-title">Cars (${cars.length})</h3>
        <ul class="list flush">${cars.map((car) => `<li><button class="list-btn" data-action="edit-car" data-car="${car.id}">
          <span><strong>${esc(car.make_model)}</strong><small>${esc(car.plate)} · ${car.status === "stored" ? "Stored" : "Retrieved"}</small></span>
          <span class="dots">${car.action_alert ? `<span class="alert-dot small">!</span>` : ""}${dots(car)}</span>
        </button></li>`).join("") || `<li class="empty">No cars yet.</li>`}</ul>
        <button class="btn primary small" data-action="new-car">+ Add car</button>
      </section>
    </main>`;
}

function carEditor(car, isNew) {
  const presets = ["Book Service", "Book Detailing", "Book Detailing / Service", "Battery check due", "Insurance renewal due"];
  const slider = (key, label) => `
    <label class="slider"><span>${label} <output style="color:${conditionColor(clamp(car[key]))}">${clamp(car[key])} %</output></span>
      <input type="range" name="${key}" min="0" max="100" step="1" value="${clamp(car[key])}"></label>`;

  openModal(`
    <form class="sheet" id="car-form">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button>
        <h2>${isNew ? "New car" : esc(car.make_model)}</h2><button class="link strong" type="submit">Save</button></header>
      <fieldset><legend>Car</legend>
        <label class="field"><span>Make & model</span><input name="make_model" required value="${esc(car.make_model)}" placeholder="Ferrari 458 Italia"></label>
        <label class="field"><span>Plate</span><input name="plate" value="${esc(car.plate)}" placeholder="GR 164789"></label>
        <div class="segmented" role="radiogroup" aria-label="Status">
          <label><input type="radio" name="status" value="stored" ${car.status === "stored" ? "checked" : ""}><span>Stored</span></label>
          <label><input type="radio" name="status" value="retrieved" ${car.status === "retrieved" ? "checked" : ""}><span>Retrieved</span></label>
        </div>
      </fieldset>
      <fieldset><legend>Insurance</legend>
        <label class="field"><span>Insurer</span><input name="insurance" value="${esc(car.insurance)}"></label>
        <label class="field"><span>Policy number</span><input name="policy_number" value="${esc(car.policy_number)}"></label>
      </fieldset>
      <fieldset><legend>Usage</legend>
        <label class="field"><span>Mileage (km)</span><input name="mileage_km" type="number" min="0" inputmode="numeric" value="${car.mileage_km ?? 0}"></label>
        <label class="check"><input type="checkbox" name="has_fuel" ${car.fuel_level != null ? "checked" : ""}> Show fuel level</label>
        <div id="fuel-wrap">${slider("fuel_level", "Fuel")}</div>
        <label class="field"><span>Last check-in/out</span><input name="last_check_at" type="date" value="${esc((car.last_check_at || "").slice(0, 10))}"></label>
      </fieldset>
      <fieldset><legend>Condition</legend>
        ${slider("interior", "Interior")}${slider("exterior", "Exterior")}${slider("battery", "Battery")}${slider("service", "Service")}
      </fieldset>
      <fieldset><legend>Action alert</legend>
        <input name="action_alert" value="${esc(car.action_alert || "")}" placeholder="No alert" aria-label="Action alert">
        <div class="presets">${presets.map((p) => `<button type="button" class="chip-btn" data-preset="${esc(p)}">${esc(p)}</button>`).join("")}
          <button type="button" class="chip-btn" data-preset="">Clear</button></div>
        <small class="muted">Shown in red on the client's car. Clients can tap it to send a request.</small>
      </fieldset>
      <fieldset><legend>Location</legend>
        <label class="field"><span>Name</span><input name="location_name" value="${esc(car.location_name || "")}" placeholder="CARPADS Storage · Bay 4"></label>
        <div class="row">
          <label class="field"><span>Latitude</span><input name="latitude" type="number" step="any" value="${car.latitude ?? ""}"></label>
          <label class="field"><span>Longitude</span><input name="longitude" type="number" step="any" value="${car.longitude ?? ""}"></label>
        </div>
        <small class="muted">Optional. Coordinates show a map pin. In Google Maps, right-click a spot to copy them.</small>
      </fieldset>
      ${isNew ? "" : `<button type="button" class="btn danger" data-action-modal="delete">Delete car</button>`}
    </form>`, (dlg) => {
    const form = dlg.querySelector("form");
    if (car.fuel_level == null) form.fuel_level.value = 50;
    const syncFuel = () => { dlg.querySelector("#fuel-wrap").hidden = !form.has_fuel.checked; };
    syncFuel();
    form.has_fuel.addEventListener("change", syncFuel);
    form.querySelectorAll('input[type="range"]').forEach((r) => r.addEventListener("input", () => {
      const out = r.parentElement.querySelector("output");
      out.textContent = `${r.value} %`;
      out.style.color = conditionColor(Number(r.value));
    }));
    form.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => { form.action_alert.value = b.dataset.preset; }));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const num = (k) => (f.get(k) === "" ? null : Number(f.get(k)));
      const text = (k) => String(f.get(k) || "").trim();
      const saved = {
        ...car,
        make_model: text("make_model"),
        plate: text("plate"),
        status: f.get("status"),
        insurance: text("insurance"),
        policy_number: text("policy_number"),
        mileage_km: Math.max(0, Math.round(num("mileage_km") || 0)),
        fuel_level: form.has_fuel.checked ? clamp(f.get("fuel_level")) : null,
        last_check_at: text("last_check_at") || null,
        interior: clamp(f.get("interior")), exterior: clamp(f.get("exterior")),
        battery: clamp(f.get("battery")), service: clamp(f.get("service")),
        action_alert: text("action_alert") || null,
        location_name: text("location_name") || null,
        latitude: num("latitude"), longitude: num("longitude"),
      };
      await run(dlg.querySelector('button[type="submit"]'), () => state.backend.saveCar(saved));
      $modal.close();
      toast("Car saved.");
      render();
    });

    dlg.querySelector('[data-action-modal="delete"]')?.addEventListener("click", async (e) => {
      if (!e.target.dataset.armed) {
        e.target.dataset.armed = "1";
        e.target.textContent = `Tap again to delete ${car.make_model}`;
        return;
      }
      await run(e.target, () => state.backend.deleteCar(car.id));
      $modal.close();
      toast("Car deleted.");
      render();
    });
  });
}

function newClientDialog() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const gen = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => chars[n % chars.length]).join("");
  openModal(`
    <form class="sheet" id="client-form">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>New client</h2><span></span></header>
      <label class="field"><span>Full name</span><input name="full_name" required autocomplete="off"></label>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="off"></label>
      <label class="field"><span>Phone (optional)</span><input name="phone" type="tel" autocomplete="off"></label>
      <label class="field"><span>Temporary password</span>
        <div class="row"><input name="password" required minlength="8" value="${gen()}" class="mono">
        <button type="button" class="btn ghost small" data-action-modal="regen" aria-label="New password">↻</button></div></label>
      <small class="muted">Share the login with your client. They can change the password under Account.</small>
      <button class="btn primary" type="submit">Create client</button>
    </form>`, (dlg) => {
    const form = dlg.querySelector("form");
    dlg.querySelector('[data-action-modal="regen"]').addEventListener("click", () => { form.password.value = gen(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const email = String(f.get("email")).trim().toLowerCase();
      const password = String(f.get("password"));
      const client = await run(form.querySelector("[type=submit]"), () => state.backend.createClient({
        fullName: String(f.get("full_name")).trim(), email,
        phone: String(f.get("phone")).trim() || null, password,
      }));
      const details = `CARPADS Client Garage\n${location.origin}${location.pathname}\nEmail: ${email}\nPassword: ${password}`;
      openModal(`<div class="sheet">
        <header class="sheet-head"><span></span><h2>Client created</h2><button class="link" data-close>Done</button></header>
        <p>Send these login details to ${esc(client.full_name || email)}:</p>
        <pre class="login-details">${esc(details)}</pre>
        <button class="btn primary" data-action-modal="copy">Copy login details</button>
      </div>`, (d2) => {
        d2.querySelector('[data-action-modal="copy"]').addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(details); toast("Copied."); } catch { toast("Select the text to copy it."); }
        });
      });
      $modal.addEventListener("close", () => { location.hash = `#client-${client.id}`; render(); }, { once: true });
    });
  });
}

function resetClientPasswordDialog(client) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const password = Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => chars[n % chars.length]).join("");
  openModal(`
    <div class="sheet">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>New password</h2><span></span></header>
      <p>Give ${esc(client.full_name || client.email)} a new temporary password? They'll be signed out on their devices.</p>
      <button class="btn primary" data-action-modal="confirm">Set new password</button>
    </div>`, (dlg) => {
    dlg.querySelector('[data-action-modal="confirm"]').addEventListener("click", async (e) => {
      await run(e.target, () => state.backend.resetClientPassword(client.id, password));
      const details = `CARPADS Client Garage\n${location.origin}${location.pathname}\nEmail: ${client.email}\nPassword: ${password}`;
      openModal(`<div class="sheet">
        <header class="sheet-head"><span></span><h2>Password changed</h2><button class="link" data-close>Done</button></header>
        <p>Send these login details to ${esc(client.full_name || client.email)}:</p>
        <pre class="login-details">${esc(details)}</pre>
        <button class="btn primary" data-action-modal="copy">Copy login details</button>
      </div>`, (d2) => {
        d2.querySelector('[data-action-modal="copy"]').addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(details); toast("Copied."); } catch { toast("Select the text to copy it."); }
        });
      });
    });
  });
}

function editClientDialog(client) {
  openModal(`
    <form class="sheet">
      <header class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>Edit client</h2><button class="link strong" type="submit">Save</button></header>
      <label class="field"><span>Full name</span><input name="full_name" value="${esc(client.full_name || "")}"></label>
      <label class="field"><span>Phone</span><input name="phone" type="tel" value="${esc(client.phone || "")}"></label>
      <small class="muted">Email: ${esc(client.email || "–")}</small>
    </form>`, (dlg) => {
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      await run(e.target.querySelector('[type="submit"]'), () => state.backend.updateClient({
        ...client, full_name: String(f.get("full_name")).trim() || null, phone: String(f.get("phone")).trim() || null,
      }));
      $modal.close();
      render();
    });
  });
}

async function viewAdminRequests() {
  document.title = "Requests | CARPADS Manager";
  $app.innerHTML = `${topbar("Manager", { admin: true })}${adminTabs("requests")}
    <main class="page"><div class="loading">Loading requests…</div></main>`;
  const requests = await state.backend.openRequests();
  $app.querySelector("main").innerHTML = requests.length ? `<ul class="list requests">${requests.map((r) => `
    <li class="request">
      <div class="request-head"><span class="kind kind-${esc(r.kind)}">${esc(KINDS[r.kind]?.label || r.kind)}</span>
        ${r.preferred_date ? `<strong>${dayName(r.preferred_date)} ${swissDate(r.preferred_date)}</strong>` : ""}
        ${r.time_window ? `<span class="muted">${esc(TIME_WINDOWS[r.time_window] || r.time_window)}</span>` : ""}</div>
      <div><strong>${esc(r.cars?.make_model || "Car")}</strong> <span class="muted">${esc(r.cars?.plate || "")}</span></div>
      <div class="muted">${esc(r.profiles?.full_name || r.profiles?.email || "")}
        ${r.profiles?.phone ? ` · <a href="tel:${esc(r.profiles.phone.replace(/\s/g, ""))}">${esc(r.profiles.phone)}</a>` : ""}</div>
      ${r.address ? `<div>📍 ${esc(r.address)}</div>` : ""}
      ${r.message ? `<div class="quote">“${esc(r.message)}”</div>` : ""}
      <div class="request-foot"><small class="muted">Received ${swissDate(r.created_at)}</small>
        <button class="btn outline small" data-action="resolve" data-id="${r.id}">Mark done</button></div>
    </li>`).join("")}</ul>`
    : `<p class="empty center">No open requests.<br>Delivery, pickup and service requests from clients appear here.</p>`;
}

// ───────────────────────── routing & events ─────────────────────────

async function render() {
  window.scrollTo(0, 0);
  const hash = location.hash || "";
  const p = state.profile;
  try {
    if (!p) return viewLogin();
    if (p.role === "admin") {
      let m;
      if (hash === "#requests") return await viewAdminRequests();
      if ((m = hash.match(/^#client-(.+)$/))) return await viewAdminClient(m[1]);
      if (hash !== "#admin") { history.replaceState(null, "", "#admin"); }
      return await viewAdminClients();
    }
    const m = hash.match(/^#car-(.+)$/);
    if (m) return await viewCar(m[1]);
    if (hash !== "#garage") history.replaceState(null, "", "#garage");
    return await viewGarage();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `${topbar("CARPADS")}<main class="page"><p class="error">${esc(err.message || "Could not load.")}</p>
      <button class="btn outline" onclick="location.reload()">Try again</button></main>`;
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "toggle") { state.collapsed[el.dataset.status] = !state.collapsed[el.dataset.status]; viewGarage(); }
  else if (a === "request") {
    const car = (state.cars || []).find((c) => c.id === el.dataset.car);
    if (car) requestDialog(car, kindsFor(car).includes(el.dataset.kind) ? el.dataset.kind : logisticsKind(car));
  }
  else if (a === "account") accountDialog();
  else if (a === "install") state.installPrompt?.prompt();
  else if (a === "dismiss-install") {
    try { localStorage.setItem("carpads-install-dismissed", "1"); } catch { /* ignore */ }
    el.closest(".install")?.remove();
  }
  else if (a === "new-client") newClientDialog();
  else if (a === "edit-client") editClientDialog(state.adminClient);
  else if (a === "reset-client-pw") resetClientPasswordDialog(state.adminClient);
  else if (a === "new-car") {
    carEditor({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), owner_id: state.adminClient.id,
      make_model: "", plate: "", insurance: "", policy_number: "", mileage_km: 0, fuel_level: null, status: "stored",
      interior: 100, exterior: 100, battery: 100, service: 100, action_alert: null, location_name: null,
      latitude: null, longitude: null, last_check_at: new Date().toISOString().slice(0, 10),
    }, true);
  }
  else if (a === "edit-car") carEditor(state.adminCars.find((c) => c.id === el.dataset.car), false);
  else if (a === "resolve") run(el, () => state.backend.resolveRequest(el.dataset.id)).then(() => { toast("Marked as done."); render(); });
});

window.addEventListener("hashchange", render);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installPrompt = e; });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* app still works online */ });
}

(async function start() {
  try {
    state.backend = await createBackend();
    state.profile = await state.backend.restore();
  } catch (err) {
    console.error(err);
  }
  // Demo only: ?demo=client or ?demo=admin signs in directly (handy for previews and screenshots).
  const demoRole = new URLSearchParams(location.search).get("demo");
  if (isDemo && !state.profile && demoRole) {
    const creds = demoRole === "admin" ? ["admin@carpads.ch", "admin"] : ["demo@carpads.ch", "demo"];
    state.profile = await state.backend.signIn(...creds).catch(() => null);
  }
  render();
  if (state.backend?.recovery && state.profile) newPasswordDialog();
})();
