import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { audit, createUser, listUsers, orgMonthSpend, rotateToken, updateUser, usageReport, userByName, userByToken } from "./db.js";
import { PAGE, SCRIPT, STYLE } from "./admin-ui.js";

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
