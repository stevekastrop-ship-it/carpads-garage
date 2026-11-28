// Backend access. Two implementations with the same methods:
//  - SupabaseBackend: the live database (access rules enforced server-side, see supabase/schema.sql)
//  - DemoBackend: sample data kept in this browser, used while config.js has no Supabase keys
import { CONFIG } from "./config.js";

export const mode = CONFIG.useServer ? "server"
  : (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? "supabase" : "demo");
export const isDemo = mode === "demo";

export async function createBackend() {
  if (mode === "server") return new ServerBackend();
  if (mode === "supabase") return SupabaseBackend.create();
  return new DemoBackend();
}

// ───────────────────────── Own server (server/ add-on) ─────────────────────────

class ServerBackend {
  noEmailReset = true; // no password-reset emails here; users change it under Account

  async call(method, path, body) {
    let res;
    try {
      res = await fetch(`api/${path}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Garage": "1" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("No connection. Please check your internet and try again.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Something went wrong.");
    return data;
  }

  async restore() { return (await this.call("GET", "me")).profile; }
  async signIn(email, password) { return this.call("POST", "login", { email, password }); }
  async signOut() { await this.call("POST", "logout", {}); }
  async resetPassword() {
    throw new Error("Please contact CARPADS and we'll set a new password for you.");
  }
  async changePassword(password) { await this.call("POST", "password", { password }); }
  async myCars() { return this.call("GET", "my/cars"); }
  async myRequests() { return this.call("GET", "my/requests"); }
  async myHistory() { return this.call("GET", "my/history"); }
  async createRequest({ car, kind, preferredDate, timeWindow, address, message }) {
    await this.call("POST", "requests", {
      car_id: car.id, kind, preferred_date: preferredDate, time_window: timeWindow, address, message,
    });
  }
  async clients() { return this.call("GET", "clients"); }
  async carsFor(ownerId) { return this.call("GET", `clients/${encodeURIComponent(ownerId)}/cars`); }
  async saveCar(car) { await this.call("PUT", `cars/${encodeURIComponent(car.id)}`, car); }
  async deleteCar(id) { await this.call("DELETE", `cars/${encodeURIComponent(id)}`, {}); }
  async createClient({ fullName, email, phone, password }) {
    return this.call("POST", "clients", { full_name: fullName, email, phone, password });
  }
  async updateClient(p) {
    await this.call("PATCH", `clients/${encodeURIComponent(p.id)}`, { full_name: p.full_name, phone: p.phone });
  }
  async resetClientPassword(id, password) {
    await this.call("POST", `clients/${encodeURIComponent(id)}/password`, { password });
  }
  async openRequests() { return this.call("GET", "requests/open"); }
  async resolveRequest(id) { await this.call("POST", `requests/${encodeURIComponent(id)}/done`, {}); }
  async clientRequests(ownerId) { return this.call("GET", `clients/${encodeURIComponent(ownerId)}/requests`); }
}

// ───────────────────────── Supabase ─────────────────────────

function must({ data, error }) {
  if (error) throw new Error(error.message || "Something went wrong.");
  return data;
}

class SupabaseBackend {
  static async create() {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm");
    const backend = new SupabaseBackend();
    // A password-reset email link lands here with "type=recovery" in the address.
    const link = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
    backend.recovery = link.get("type") === "recovery";
    // An expired or already-used link comes back with an error instead of tokens.
    backend.linkError = link.get("error_description")?.replace(/\+/g, " ") || null;
    backend.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    backend.sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") backend.recovery = true; });
    const { data } = await backend.sb.auth.getSession(); // lets the client read the link's tokens first
    if (link.get("code") && !data.session) {
      await backend.sb.auth.exchangeCodeForSession(link.get("code")).catch(() => {});
    }
    if (backend.recovery || backend.linkError || link.get("code")) history.replaceState(null, "", location.pathname);
    backend.hasSession = async () => !!(await backend.sb.auth.getSession()).data.session;
    return backend;
  }

  async profile(id) {
    return must(await this.sb.from("profiles").select("*").eq("id", id).single());
  }

  async uid() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) throw new Error("Please sign in again.");
    return data.session.user.id;
  }

  async restore() {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    try { return await this.profile(user.id); } catch { return null; }
  }

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Email or password is not correct.");
    return this.profile(data.user.id);
  }

  async signOut() { await this.sb.auth.signOut(); }

  // Owners create their own free account. Returns { profile } when signed in right away,
  // or { confirm: true } when they first need to click the link in the confirmation email.
  async signUp({ fullName, email, password }) {
    const { data, error } = await this.sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw new Error(error.message || "Could not create the account.");
    if (!data.session) return { confirm: true };
    return { profile: await this.profile(data.user.id) };
  }

  async resetPassword(email) {
    const redirectTo = location.origin + location.pathname;
    must(await this.sb.auth.resetPasswordForEmail(email, { redirectTo }));
  }

  async changePassword(password) {
    must(await this.sb.auth.updateUser({ password }));
  }

  async myCars() { return this.carsFor(await this.uid()); }

  async myRequests() {
    const uid = await this.uid();
    return must(await this.sb.from("service_requests").select("*")
      .eq("owner_id", uid).eq("status", "open").order("created_at", { ascending: false }));
  }

  // Your own requests, open and done (access rules only return your own).
  async myHistory() { return this.clientRequests(await this.uid()); }

  async createRequest({ car, kind, preferredDate, timeWindow, address, message }) {
    const uid = await this.uid();
    must(await this.sb.from("service_requests").insert({
      car_id: car.id, owner_id: uid, kind,
      preferred_date: preferredDate || null, time_window: timeWindow || null,
      address: address || null, message: message || null,
    }));
  }

  async clients() {
    return must(await this.sb.from("profiles").select("*").eq("role", "client").order("full_name"));
  }

  async carsFor(ownerId) {
    return must(await this.sb.from("cars").select("*").eq("owner_id", ownerId).order("make_model"));
  }

  async saveCar(car) { must(await this.sb.from("cars").upsert(car)); }

  async deleteCar(id) { must(await this.sb.from("cars").delete().eq("id", id)); }

  async createClient({ fullName, email, phone, password }) {
    const { data, error } = await this.sb.functions.invoke("create-client", {
      body: { full_name: fullName, email, phone, password },
    });
    if (error) {
      let message = error.message;
      try { message = (await error.context.json()).error || message; } catch { /* keep default */ }
      throw new Error(message);
    }
    return data;
  }

  async updateClient(p) {
    must(await this.sb.from("profiles").update({ full_name: p.full_name, phone: p.phone }).eq("id", p.id));
  }

  async openRequests() {
    return must(await this.sb.from("service_requests")
      .select("*, cars(make_model, plate), profiles(full_name, email, phone)")
      .eq("status", "open")
      .order("preferred_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }));
  }

  async resolveRequest(id) {
    // done_at is set by the database (see stamp_request_done in schema.sql).
    must(await this.sb.from("service_requests").update({ status: "done" }).eq("id", id));
  }

  // All of one client's requests, open and done (admin history).
  async clientRequests(ownerId) {
    return must(await this.sb.from("service_requests")
      .select("*, cars(make_model, plate)")
      .eq("owner_id", ownerId)
      .order("done_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }));
  }
}

// ───────────────────────── Demo (in this browser) ─────────────────────────

const DEMO_KEY = "carpads-garage-demo-v2"; // v2: managers, self-managed owners, due dates
const CARPADS_ORG = "carpads";
const SESSION_KEY = "carpads-garage-demo-session";

const isoDay = (date) => date.toISOString().slice(0, 10);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (Math.random() * 16) >> (c / 4)).toString(16)));

function seed() {
  const admin = { id: uuid(), full_name: "Steve Kastrop", email: "admin@carpads.ch", phone: "+41 78 326 48 48", role: "admin", managed_by: null, plan: "free" };
  const demo = { id: uuid(), full_name: "Demo Client", email: "demo@carpads.ch", phone: "+41 79 000 00 00", role: "client", managed_by: CARPADS_ORG, plan: "free" };
  // An owner who signed up in the app and keeps their car elsewhere (no manager, free plan).
  const owner = { id: uuid(), full_name: "Demo Owner", email: "owner@carpads.ch", phone: null, role: "client", managed_by: null, plan: "free" };
  const soon = (days) => isoDay(new Date(Date.now() + days * 86400000));
  const car = (o) => ({
    id: uuid(), owner_id: demo.id, insurance: "Allianz", fuel_level: null, action_alert: null,
    location_name: null, latitude: null, longitude: null, ...o,
  });
  return {
    profiles: [admin, demo, owner],
    passwords: { "admin@carpads.ch": "admin", "demo@carpads.ch": "demo", "owner@carpads.ch": "owner" },
    cars: [
      car({ make_model: "Rolls-Royce Spectre", plate: "GR 164789", policy_number: "16.548.9563", mileage_km: 1230,
        status: "stored", interior: 84, exterior: 58, battery: 98, service: 25, action_alert: "Book Service",
        location_name: "CARPADS Storage · Bay 4", latitude: 46.8499, longitude: 9.5329, last_check_at: "2024-09-12" }),
      car({ make_model: "Mercedes G500 AMG", plate: "VS 544789", policy_number: "16.548.9856", mileage_km: 13530,
        fuel_level: 50, status: "stored", interior: 15, exterior: 31, battery: 61, service: 5,
        action_alert: "Book Detailing / Service", location_name: "CARPADS Storage · Bay 7",
        latitude: 46.8499, longitude: 9.5329, last_check_at: "2024-02-23" }),
      car({ make_model: "Ferrari 458 Italia", plate: "GR 388883", policy_number: "16.598.6789", mileage_km: 5640,
        status: "retrieved", interior: 75, exterior: 90, battery: 100, service: 87,
        location_name: "With owner", last_check_at: "2024-04-15", mfk_due: soon(40) }),
      car({ owner_id: owner.id, make_model: "Porsche 911 Carrera 2.7", plate: "ZH 911273", insurance: "AXA",
        policy_number: "", mileage_km: 88400, status: "retrieved", location_name: "Private garage, Zürich",
        last_check_at: null, interior: 0, exterior: 0, battery: 0, service: 0,
        mfk_due: soon(-12), insurance_due: soon(75), service_due: soon(150), notes: "Battery charger on every 2 weeks.",
        updated_at: new Date(Date.now() - 43 * 86400000).toISOString() }),
    ],
    requests: [],
  };
}

class DemoBackend {
  constructor() {
    this.db = null;
    try { this.db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { /* storage unavailable */ }
    if (!this.db) { this.db = seed(); this.persist(); }
    this.current = null;
  }

  persist() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch { /* demo still works in memory */ }
  }

  me() {
    if (!this.current) throw new Error("Please sign in again.");
    return this.current;
  }

  admin() {
    if (this.me().role !== "admin") throw new Error("Only CARPADS staff can do this.");
  }

  async restore() {
    let id = null;
    try { id = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
    this.current = this.db.profiles.find((p) => p.id === id) || null;
    return this.current;
  }

  async signIn(email, password) {
    const p = this.db.profiles.find((x) => x.email === email);
    if (!p || this.db.passwords[email] !== password) throw new Error("Email or password is not correct.");
    this.current = p;
    try { sessionStorage.setItem(SESSION_KEY, p.id); } catch { /* ignore */ }
    return p;
  }

  async signUp({ fullName, email, password }) {
    if (this.db.profiles.some((p) => p.email === email)) throw new Error("An account with this email already exists.");
    const p = { id: uuid(), full_name: fullName, email, phone: null, role: "client", managed_by: null, plan: "free" };
    this.db.profiles.push(p);
    this.db.passwords[email] = password;
    this.persist();
    return { profile: await this.signIn(email, password) };
  }

  async resetPassword() {
    throw new Error("Password reset emails are not sent in demo mode.");
  }

  async signOut() {
    this.current = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  async changePassword(password) {
    this.db.passwords[this.me().email] = password;
    this.persist();
  }

  async myCars() {
    const me = this.me();
    return this.db.cars.filter((c) => c.owner_id === me.id).sort(byName);
  }

  async myRequests() {
    const me = this.me();
    return this.db.requests.filter((r) => r.owner_id === me.id && r.status === "open");
  }

  async createRequest({ car, kind, preferredDate, timeWindow, address, message }) {
    const me = this.me();
    if (me.managed_by == null) throw new Error("Requests go to your storage manager. You don't have one yet.");
    this.db.requests.unshift({
      id: uuid(), car_id: car.id, owner_id: me.id, kind, status: "open",
      preferred_date: preferredDate || null, time_window: timeWindow || null,
      address: address || null, message: message || null, created_at: new Date().toISOString(),
    });
    this.persist();
  }

  async clients() {
    this.admin();
    return this.db.profiles.filter((p) => p.role === "client")
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  }

  async carsFor(ownerId) {
    this.admin();
    return this.db.cars.filter((c) => c.owner_id === ownerId).sort(byName);
  }

  // Same rules as the database: the admin edits every car; an owner without a manager edits their own,
  // up to 2 cars on the free plan.
  canEdit(ownerId) {
    const me = this.me();
    if (me.role === "admin") return;
    if (me.managed_by == null && ownerId === me.id) return;
    throw new Error("Only CARPADS staff can do this.");
  }

  async saveCar(car) {
    this.canEdit(car.owner_id);
    const i = this.db.cars.findIndex((c) => c.id === car.id);
    const owner = this.db.profiles.find((p) => p.id === car.owner_id);
    if (i < 0 && owner?.managed_by == null && owner?.role === "client" && owner?.plan !== "plus"
      && this.db.cars.filter((c) => c.owner_id === car.owner_id).length >= 2) {
      throw new Error("The free plan holds up to 2 cars.");
    }
    const saved = { ...car, updated_at: new Date().toISOString() };
    if (i >= 0) this.db.cars[i] = saved; else this.db.cars.push(saved);
    this.persist();
  }

  async deleteCar(id) {
    this.canEdit(this.db.cars.find((c) => c.id === id)?.owner_id);
    this.db.cars = this.db.cars.filter((c) => c.id !== id);
    this.db.requests = this.db.requests.filter((r) => r.car_id !== id);
    this.persist();
  }

  async createClient({ fullName, email, phone, password }) {
    this.admin();
    if (this.db.profiles.some((p) => p.email === email)) throw new Error("A client with this email already exists.");
    const p = { id: uuid(), full_name: fullName, email, phone: phone || null, role: "client", managed_by: CARPADS_ORG, plan: "free" };
    this.db.profiles.push(p);
    this.db.passwords[email] = password;
    this.persist();
    return p;
  }

  async updateClient(p) {
    this.admin();
    const i = this.db.profiles.findIndex((x) => x.id === p.id);
    if (i >= 0) this.db.profiles[i] = { ...this.db.profiles[i], full_name: p.full_name, phone: p.phone };
    this.persist();
  }

  async openRequests() {
    this.admin();
    return this.db.requests.filter((r) => r.status === "open").map((r) => {
      const car = this.db.cars.find((c) => c.id === r.car_id);
      const owner = this.db.profiles.find((p) => p.id === r.owner_id);
      return {
        ...r,
        cars: car ? { make_model: car.make_model, plate: car.plate } : null,
        profiles: owner ? { full_name: owner.full_name, email: owner.email, phone: owner.phone } : null,
      };
    }).sort((a, b) => (a.preferred_date || "9999").localeCompare(b.preferred_date || "9999"));
  }

  async resolveRequest(id) {
    this.admin();
    const r = this.db.requests.find((x) => x.id === id);
    if (r && r.status === "open") { r.status = "done"; r.done_at = new Date().toISOString(); }
    this.persist();
  }

  async clientRequests(ownerId) {
    this.admin();
    return this.history(ownerId);
  }

  async myHistory() { return this.history(this.me().id); }

  history(ownerId) {
    return this.db.requests.filter((r) => r.owner_id === ownerId).map((r) => {
      const car = this.db.cars.find((c) => c.id === r.car_id);
      return { ...r, cars: car ? { make_model: car.make_model, plate: car.plate } : null };
    }).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "") || (b.created_at || "").localeCompare(a.created_at || ""));
  }

  /** Demo only: put the sample data back. */
  reset() {
    this.db = seed();
    this.persist();
  }
}

const byName = (a, b) => a.make_model.localeCompare(b.make_model);
