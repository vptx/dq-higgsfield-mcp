import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { audit, createUser, listUsers, orgMonthSpend, rotateToken, updateUser, usageReport, userByName, userByToken } from "./db.js";

const connectorUrl = (token: string) => `${config.publicBaseUrl}/mcp/u/${token}`;
const sha = (s: string) => createHash("sha256").update(s).digest();

function passwordMatches(given: string): boolean {
  if (config.adminPassword.length < 16) return false;
  return timingSafeEqual(sha(given), sha(config.adminPassword));
}

/* Failed sign-ins per IP: 10 per 10 minutes, then locked until the window resets. */
const failures = new Map<string, { n: number; reset: number }>();
const FAIL_MAX = 10;
const FAIL_WINDOW_MS = 10 * 60_000;
function lockedOut(ip: string): boolean {
  const f = failures.get(ip);
  return Boolean(f && f.reset > Date.now() && f.n >= FAIL_MAX);
}
function recordFailure(ip: string): void {
  const t = Date.now();
  const f = failures.get(ip);
  if (!f || f.reset < t) failures.set(ip, { n: 1, reset: t + FAIL_WINDOW_MS });
  else f.n++;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of failures) if (v.reset < t) failures.delete(k);
}, 60_000).unref();

type Actor = { kind: "password" } | { kind: "user"; id: string; name: string };

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "unknown";
  if (lockedOut(ip)) {
    res.status(429).json({ error: "محاولات كثيرة، جرّب بعد 10 دقائق" });
    return;
  }
  const header = req.header("authorization");
  const secret = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  let actor: Actor | undefined;
  if (secret.startsWith("bc_")) {
    const u = userByToken(secret);
    if (u && !u.disabled && u.role === "admin") actor = { kind: "user", id: u.id, name: u.name };
  } else if (secret && passwordMatches(secret)) {
    actor = { kind: "password" };
  }
  if (!actor) {
    recordFailure(ip);
    res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    return;
  }
  res.locals.actor = actor;
  next();
}

const actorId = (res: Response) => {
  const a = res.locals.actor as Actor;
  return a.kind === "user" ? a.id : null;
};

const NAME_RE = /^[\p{L}\p{N}_.\- ]{1,40}$/u;
const isBudget = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000;
const isConcurrency = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20;

export const adminRouter = Router();

adminRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

adminRouter.get("/", (_req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.type("html").send(PAGE);
});
adminRouter.get("/app.js", (_req, res) => res.type("application/javascript").send(SCRIPT));
adminRouter.get("/app.css", (_req, res) => res.type("text/css").send(STYLE));

adminRouter.use("/api", requireAdmin);

adminRouter.get("/api/me", (_req, res) => {
  const a = res.locals.actor as Actor;
  res.json({ name: a.kind === "user" ? a.name : "Owner", via: a.kind });
});

adminRouter.get("/api/overview", (_req, res) => {
  const usage = new Map(usageReport().map((u) => [u.name, u]));
  const users = listUsers().map((u) => {
    const s = usage.get(u.name);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      disabled: Boolean(u.disabled),
      budget: u.monthly_budget_usd,
      concurrency: u.max_concurrent,
      used: s?.committed ?? 0,
      running: s?.reserved ?? 0,
      completed: s?.completed ?? 0,
      failed: s?.failed ?? 0,
      created_at: u.created_at,
    };
  });
  res.json({
    month: new Date().toISOString().slice(0, 7),
    org: { spent: orgMonthSpend(), budget: config.orgMonthlyBudgetUsd },
    users,
  });
});

adminRouter.post("/api/users", (req, res) => {
  const { name, budget, concurrency, admin } = (req.body ?? {}) as Record<string, unknown>;
  const clean = typeof name === "string" ? name.trim() : "";
  if (!NAME_RE.test(clean)) {
    res.status(400).json({ error: "الاسم لازم يكون من 1 إلى 40 حرف أو رقم" });
    return;
  }
  if (budget !== undefined && !isBudget(budget)) {
    res.status(400).json({ error: "الميزانية غير صالحة" });
    return;
  }
  if (concurrency !== undefined && !isConcurrency(concurrency)) {
    res.status(400).json({ error: "التزامن لازم يكون رقم بين 1 و20" });
    return;
  }
  if (userByName(clean)) {
    res.status(409).json({ error: "في عضو بنفس الاسم" });
    return;
  }
  const { user, token } = createUser({
    name: clean,
    role: admin === true ? "admin" : "member",
    monthlyBudgetUsd: budget as number | undefined,
    maxConcurrent: concurrency as number | undefined,
  });
  audit(actorId(res), "admin_web.user_create", { name: user.name });
  res.status(201).json({ name: user.name, connectorUrl: connectorUrl(token), token });
});

adminRouter.patch("/api/users/:id", (req, res) => {
  const user = listUsers().find((u) => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }
  const { budget, concurrency, role, disabled } = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateUser>[1] = {};
  if (budget !== undefined) {
    if (!isBudget(budget)) return void res.status(400).json({ error: "الميزانية غير صالحة" });
    patch.monthly_budget_usd = budget;
  }
  if (concurrency !== undefined) {
    if (!isConcurrency(concurrency)) return void res.status(400).json({ error: "التزامن لازم يكون رقم بين 1 و20" });
    patch.max_concurrent = concurrency;
  }
  if (role !== undefined) {
    if (role !== "admin" && role !== "member") return void res.status(400).json({ error: "الدور غير صالح" });
    patch.role = role;
  }
  if (disabled !== undefined) {
    if (typeof disabled !== "boolean") return void res.status(400).json({ error: "قيمة غير صالحة" });
    patch.disabled = disabled ? 1 : 0;
  }
  const self = actorId(res) === user.id;
  if (self && (patch.disabled === 1 || patch.role === "member")) {
    res.status(400).json({ error: "ما بتقدر توقف حسابك أو تشيل صلاحية الأدمن عن حالك" });
    return;
  }
  updateUser(user.id, patch);
  res.json({ ok: true });
});

adminRouter.post("/api/users/:id/rotate", (req, res) => {
  const user = listUsers().find((u) => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }
  const token = rotateToken(user.id);
  audit(actorId(res), "admin_web.user_rotate", { name: user.name });
  res.json({ name: user.name, connectorUrl: connectorUrl(token), token });
});

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Big Cloud · Higgsfield</title>
<link rel="stylesheet" href="/admin/app.css">
</head>
<body>
<main id="login" class="center" hidden>
  <form id="login-form" class="card narrow">
    <h1>Big Cloud · Higgsfield</h1>
    <p class="muted">لوحة إدارة الفريق</p>
    <label>كلمة سر الأدمن أو توكن الأدمن
      <input id="secret" type="password" autocomplete="current-password" required>
    </label>
    <button type="submit">دخول</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>

<main id="app" hidden>
  <header class="bar">
    <div>
      <h1>Big Cloud · Higgsfield</h1>
      <p class="muted" id="who"></p>
    </div>
    <button id="logout" class="ghost">خروج</button>
  </header>

  <section class="stats" id="stats"></section>

  <section class="card">
    <h2>إضافة عضو</h2>
    <form id="add-form" class="row">
      <label>الاسم<input id="add-name" required maxlength="40"></label>
      <label>الميزانية الشهرية ($)<input id="add-budget" type="number" min="0" step="1" value="50"></label>
      <label>التزامن<input id="add-conc" type="number" min="1" max="20" step="1" value="3"></label>
      <label class="check"><input id="add-admin" type="checkbox"> أدمن</label>
      <button type="submit">إضافة وتوليد رابط</button>
    </form>
    <p id="add-error" class="error" role="alert"></p>
  </section>

  <section class="card">
    <h2>الأعضاء · <span class="muted" id="month" dir="ltr"></span></h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>الاسم</th><th>الدور</th><th>الحالة</th><th>المصروف</th><th>الميزانية</th><th>التزامن</th><th>توليدات</th><th></th>
        </tr></thead>
        <tbody id="users"></tbody>
      </table>
    </div>
  </section>
</main>

<dialog id="link-dialog">
  <h2 id="link-title"></h2>
  <p class="muted">هذا الرابط بيظهر مرة وحدة بس. ابعته للعضو بشكل خاص، لأنه بمثابة كلمة سر.</p>
  <label>Connector URL (لـ Claude.ai)
    <div class="copy"><input id="link-url" readonly><button type="button" data-copy="link-url">نسخ</button></div>
  </label>
  <label>Bearer token (لـ Claude Code)
    <div class="copy"><input id="link-token" readonly><button type="button" data-copy="link-token">نسخ</button></div>
  </label>
  <ol class="muted small">
    <li>Claude ← Settings ← Connectors ← Add custom connector</li>
    <li>Name: Big Cloud Higgsfield</li>
    <li>URL: الرابط اللي فوق</li>
  </ol>
  <button type="button" id="link-close">تم</button>
</dialog>
<script src="/admin/app.js"></script>
</body>
</html>`;

const STYLE = `
:root{--bg:#0f1115;--card:#171a21;--line:#262a33;--text:#e7e9ee;--muted:#8b919e;--accent:#4f7cff;--danger:#e5484d;--ok:#30a46c;--warn:#f5a524}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px}
.center{min-height:100vh;display:grid;place-items:center}
h1{font-size:20px;margin:0}
h2{font-size:16px;margin:0 0 16px}
.muted{color:var(--muted);margin:4px 0 0}
.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:20px}
.narrow{width:100%;max-width:380px;display:grid;gap:14px}
.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.stat b{display:block;font-size:22px;margin-top:4px}
label{display:grid;gap:6px;font-size:13px;color:var(--muted)}
input{background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px;font:inherit;width:100%}
input:focus{outline:2px solid var(--accent);outline-offset:-1px}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:end}
.row label{flex:1 1 150px}
.row .check{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding-bottom:10px;color:var(--text)}
.check input{width:auto}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer;white-space:nowrap}
button:hover{filter:brightness(1.1)}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
button.danger{background:transparent;border:1px solid var(--danger);color:var(--danger)}
button.sm{padding:5px 10px;font-size:13px}
.error{color:var(--danger);min-height:1em;margin:8px 0 0}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:right;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:500;font-size:13px}
td input{width:90px;padding:5px 8px}
.actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
.pill.ok{color:var(--ok);border-color:var(--ok)}
.pill.off{color:var(--danger);border-color:var(--danger)}
.pill.admin{color:var(--warn);border-color:var(--warn)}
.meter{height:6px;background:var(--line);border-radius:3px;margin-top:6px;overflow:hidden;min-width:80px}
.meter i{display:block;height:100%;background:var(--accent)}
.meter i.hot{background:var(--danger)}
dialog{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(560px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.6)}
dialog label{margin-top:14px}
.copy{display:flex;gap:8px}
.copy input{direction:ltr;font-family:ui-monospace,Consolas,monospace;font-size:12px}
ol{padding-inline-start:20px}
`;

const SCRIPT = `(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "bc_admin_secret";
  let me = null;

  async function api(method, path, body) {
    const res = await fetch("/admin/api" + path, {
      method,
      headers: { "authorization": "Bearer " + sessionStorage.getItem(KEY), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error(data.error || "انتهت الجلسة"); }
    if (!res.ok) throw new Error(data.error || "صار خطأ");
    return data;
  }

  const money = (n) => "$" + Number(n).toFixed(2);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
    return e;
  }

  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("login-error").textContent = msg || "";
    $("secret").focus();
  }
  function logout() { sessionStorage.removeItem(KEY); showLogin(); }

  async function start() {
    if (!sessionStorage.getItem(KEY)) return showLogin();
    try {
      me = await api("GET", "/me");
    } catch (e) { return showLogin(e.message); }
    $("login").hidden = true;
    $("app").hidden = false;
    $("who").textContent = "داخل باسم: " + me.name;
    await refresh();
  }

  function showLink(title, data) {
    $("link-title").textContent = title + ": " + data.name;
    $("link-url").value = data.connectorUrl;
    $("link-token").value = data.token;
    $("link-dialog").showModal();
  }

  async function refresh() {
    const d = await api("GET", "/overview");
    $("month").textContent = d.month;
    const stats = $("stats");
    stats.replaceChildren(
      el("div", { class: "stat" }, "صرف الفريق هالشهر", el("b", {}, money(d.org.spent))),
      el("div", { class: "stat" }, "سقف الفريق", el("b", {}, d.org.budget > 0 ? money(d.org.budget) : "بدون سقف")),
      el("div", { class: "stat" }, "الأعضاء النشطين", el("b", {}, String(d.users.filter((u) => !u.disabled).length))),
    );
    $("users").replaceChildren(...d.users.map(row));
    if (!d.users.length) $("users").append(el("tr", {}, el("td", { colspan: "8", class: "muted" }, "ما في أعضاء لسا. أضف أول واحد من فوق.")));
  }

  function row(u) {
    const spent = u.used + u.running;
    const pct = u.budget > 0 ? Math.min(100, (spent / u.budget) * 100) : 100;
    const budget = el("input", { type: "number", min: "0", step: "1", value: String(u.budget), "aria-label": "ميزانية " + u.name });
    const conc = el("input", { type: "number", min: "1", max: "20", step: "1", value: String(u.concurrency), "aria-label": "تزامن " + u.name });
    const save = el("button", { class: "sm ghost", onclick: () => act(save, () => api("PATCH", "/users/" + u.id, { budget: Number(budget.value), concurrency: Number(conc.value) })) }, "حفظ");
    const isSelf = me && me.name === u.name && me.via === "user";
    const bar = el("i", { class: pct >= 90 ? "hot" : "" });
    bar.style.width = pct.toFixed(0) + "%";
    return el("tr", {},
      el("td", {}, u.name),
      el("td", {}, el("span", { class: "pill" + (u.role === "admin" ? " admin" : "") }, u.role === "admin" ? "أدمن" : "عضو")),
      el("td", {}, el("span", { class: "pill " + (u.disabled ? "off" : "ok") }, u.disabled ? "موقوف" : "نشط")),
      el("td", {}, money(spent), el("div", { class: "meter" }, bar)),
      el("td", {}, budget),
      el("td", {}, conc),
      el("td", {}, String(u.completed), u.failed ? el("span", { class: "muted small" }, " (" + u.failed + " فشل)") : null),
      el("td", {}, el("div", { class: "actions" },
        save,
        el("button", { class: "sm ghost", onclick: (e) => {
          if (!confirm("رابط جديد لـ " + u.name + "؟ الرابط القديم رح يوقف فوراً.")) return;
          act(e.currentTarget, async () => showLink("رابط جديد", await api("POST", "/users/" + u.id + "/rotate")));
        } }, "رابط جديد"),
        isSelf ? null : el("button", { class: "sm ghost", onclick: (e) => act(e.currentTarget, () => api("PATCH", "/users/" + u.id, { role: u.role === "admin" ? "member" : "admin" })) }, u.role === "admin" ? "شيل أدمن" : "اجعله أدمن"),
        isSelf ? null : el("button", { class: "sm " + (u.disabled ? "ghost" : "danger"), onclick: (e) => {
          if (!u.disabled && !confirm("إيقاف " + u.name + "؟ الـ connector تبعه رح يوقف فوراً.")) return;
          act(e.currentTarget, () => api("PATCH", "/users/" + u.id, { disabled: !u.disabled }));
        } }, u.disabled ? "تفعيل" : "إيقاف"),
      )),
    );
  }

  async function act(btn, fn) {
    btn.disabled = true;
    try { await fn(); await refresh(); }
    catch (e) { alert(e.message); }
    finally { btn.disabled = false; }
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    sessionStorage.setItem(KEY, $("secret").value.trim());
    $("secret").value = "";
    await start();
  });
  $("logout").addEventListener("click", logout);

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("add-error").textContent = "";
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const data = await api("POST", "/users", {
        name: $("add-name").value.trim(),
        budget: Number($("add-budget").value),
        concurrency: Number($("add-conc").value),
        admin: $("add-admin").checked,
      });
      $("add-form").reset();
      showLink("عضو جديد", data);
      await refresh();
    } catch (err) { $("add-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  document.addEventListener("click", (e) => {
    const id = e.target.getAttribute && e.target.getAttribute("data-copy");
    if (!id) return;
    navigator.clipboard.writeText($(id).value).then(() => {
      e.target.textContent = "انتسخ ✓";
      setTimeout(() => (e.target.textContent = "نسخ"), 1500);
    });
  });
  $("link-close").addEventListener("click", () => {
    $("link-url").value = "";
    $("link-token").value = "";
    $("link-dialog").close();
  });

  start();
})();`;
