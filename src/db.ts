import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.js";

export type Role = "member" | "admin";

export const FINAL_STATUSES = ["completed", "failed", "nsfw", "canceled", "rejected", "stale"] as const;
export const OPEN_STATUSES = ["submitting", "queued", "in_progress"] as const;
/** Statuses that count against a budget. Failed/nsfw/canceled are refunded by Higgsfield. */
export const BILLABLE_STATUSES = ["submitting", "queued", "in_progress", "completed", "stale"] as const;

export interface UserRow {
  id: string;
  name: string;
  token_hash: string;
  role: Role;
  monthly_budget_usd: number;
  max_concurrent: number;
  disabled: number;
  created_at: string;
}

export interface RequestRow {
  id: string;
  hf_request_id: string | null;
  user_id: string;
  model_id: string;
  model_path: string;
  input_json: string;
  project: string | null;
  estimated_usd: number;
  status: string;
  output_urls_json: string | null;
  archived_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  monthly_budget_usd REAL NOT NULL,
  max_concurrent INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  hf_request_id TEXT UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  model_id TEXT NOT NULL,
  model_path TEXT NOT NULL,
  input_json TEXT NOT NULL,
  project TEXT,
  estimated_usd REAL NOT NULL,
  status TEXT NOT NULL,
  output_urls_json TEXT,
  archived_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
`);

export const now = () => new Date().toISOString();
export const monthStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
export const monthEnd = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => "bc_" + randomBytes(32).toString("base64url");

export function audit(userId: string | null, action: string, detail?: unknown): void {
  db.prepare("INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)").run(
    now(),
    userId,
    action,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

/* ---------------- users ---------------- */

export function createUser(opts: {
  name: string;
  role?: Role;
  monthlyBudgetUsd?: number;
  maxConcurrent?: number;
}): { user: UserRow; token: string } {
  const token = newToken();
  const user: UserRow = {
    id: randomUUID(),
    name: opts.name,
    token_hash: hashToken(token),
    role: opts.role ?? "member",
    monthly_budget_usd: opts.monthlyBudgetUsd ?? config.defaultMonthlyBudgetUsd,
    max_concurrent: opts.maxConcurrent ?? config.defaultUserConcurrency,
    disabled: 0,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, name, token_hash, role, monthly_budget_usd, max_concurrent, disabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(user.id, user.name, user.token_hash, user.role, user.monthly_budget_usd, user.max_concurrent, 0, user.created_at);
  audit(null, "user.create", { name: user.name, role: user.role, budget: user.monthly_budget_usd });
  return { user, token };
}

export function userByToken(token: string): UserRow | undefined {
  if (!token || !token.startsWith("bc_")) return undefined;
  return db.prepare("SELECT * FROM users WHERE token_hash = ?").get(hashToken(token)) as UserRow | undefined;
}

export function userByName(name: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE name = ?").get(name) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[];
}

export function rotateToken(userId: string): string {
  const token = newToken();
  db.prepare("UPDATE users SET token_hash = ? WHERE id = ?").run(hashToken(token), userId);
  audit(null, "user.rotate", { userId });
  return token;
}

export function updateUser(userId: string, patch: Partial<Pick<UserRow, "monthly_budget_usd" | "max_concurrent" | "disabled" | "role">>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k] as number | string), userId);
  audit(null, "user.update", { userId, ...patch });
}

/* ---------------- spend ---------------- */

const billableList = BILLABLE_STATUSES.map((s) => `'${s}'`).join(",");
const openList = OPEN_STATUSES.map((s) => `'${s}'`).join(",");

export function userMonthSpend(userId: string, at = new Date()): { committed: number; reserved: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('completed','stale') THEN estimated_usd END), 0) AS committed,
         COALESCE(SUM(CASE WHEN status IN (${openList}) THEN estimated_usd END), 0) AS reserved
       FROM requests WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(userId, monthStart(at), monthEnd(at)) as { committed: number; reserved: number };
  return row;
}

export function orgMonthSpend(at = new Date()): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(estimated_usd),0) AS s FROM requests WHERE status IN (${billableList}) AND created_at >= ? AND created_at < ?`)
    .get(monthStart(at), monthEnd(at)) as { s: number };
  return row.s;
}

export function openCount(userId?: string): number {
  const row = userId
    ? (db.prepare(`SELECT COUNT(*) AS c FROM requests WHERE status IN (${openList}) AND user_id = ?`).get(userId) as { c: number })
    : (db.prepare(`SELECT COUNT(*) AS c FROM requests WHERE status IN (${openList})`).get() as { c: number });
  return row.c;
}

export type ReserveResult =
  | { ok: true; request: RequestRow }
  | { ok: false; reason: "budget" | "org_budget" | "user_concurrency" | "global_concurrency"; detail: string };

/**
 * Atomically checks budget + concurrency and inserts a "submitting" row that reserves the estimated cost.
 * node:sqlite is synchronous, and this runs inside one BEGIN IMMEDIATE transaction, so two parallel
 * calls cannot both pass the check.
 */
export function reserve(user: UserRow, args: { modelId: string; modelPath: string; input: unknown; project?: string; estimatedUsd: number }): ReserveResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (openCount(user.id) >= user.max_concurrent) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "user_concurrency", detail: `You already have ${user.max_concurrent} generations running. Wait for one to finish.` };
    }
    if (openCount() >= config.globalConcurrency) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "global_concurrency", detail: "The team is at the shared concurrency limit right now. Try again in a minute." };
    }
    const spend = userMonthSpend(user.id);
    const used = spend.committed + spend.reserved;
    if (used + args.estimatedUsd > user.monthly_budget_usd + 1e-9) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "budget",
        detail: `Monthly budget exceeded: used $${used.toFixed(3)} of $${user.monthly_budget_usd.toFixed(2)}, this generation needs ~$${args.estimatedUsd.toFixed(3)}. Ask an admin to raise your budget.`,
      };
    }
    if (config.orgMonthlyBudgetUsd > 0 && orgMonthSpend() + args.estimatedUsd > config.orgMonthlyBudgetUsd + 1e-9) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "org_budget", detail: "The team's monthly Higgsfield budget is used up. Ask an admin." };
    }
    const t = now();
    const row: RequestRow = {
      id: randomUUID(),
      hf_request_id: null,
      user_id: user.id,
      model_id: args.modelId,
      model_path: args.modelPath,
      input_json: JSON.stringify(args.input),
      project: args.project ?? null,
      estimated_usd: args.estimatedUsd,
      status: "submitting",
      output_urls_json: null,
      archived_json: null,
      error: null,
      created_at: t,
      updated_at: t,
    };
    db.prepare(
      `INSERT INTO requests (id, hf_request_id, user_id, model_id, model_path, input_json, project, estimated_usd, status, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'submitting', ?, ?)`,
    ).run(row.id, row.user_id, row.model_id, row.model_path, row.input_json, row.project, row.estimated_usd, t, t);
    db.exec("COMMIT");
    return { ok: true, request: row };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw e;
  }
}

/* ---------------- requests ---------------- */

export function updateRequest(id: string, patch: Partial<Omit<RequestRow, "id" | "user_id" | "created_at">>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  const sets = [...keys.map((k) => `${k} = ?`), "updated_at = ?"].join(", ");
  db.prepare(`UPDATE requests SET ${sets} WHERE id = ?`).run(...keys.map((k) => (patch[k] ?? null) as string | number | null), now(), id);
}

export function getRequest(idOrHfId: string): RequestRow | undefined {
  return db.prepare("SELECT * FROM requests WHERE id = ? OR hf_request_id = ?").get(idOrHfId, idOrHfId) as RequestRow | undefined;
}

export function openRequests(): RequestRow[] {
  return db.prepare(`SELECT * FROM requests WHERE status IN ('queued','in_progress') AND hf_request_id IS NOT NULL ORDER BY created_at`).all() as unknown as RequestRow[];
}

export function listUserRequests(userId: string, limit: number, project?: string): RequestRow[] {
  if (project) {
    return db
      .prepare("SELECT * FROM requests WHERE user_id = ? AND project = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, project, limit) as unknown as RequestRow[];
  }
  return db.prepare("SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as unknown as RequestRow[];
}

export interface UsageLine {
  name: string;
  role: string;
  monthly_budget_usd: number;
  committed: number;
  reserved: number;
  completed: number;
  failed: number;
}

export function usageReport(at = new Date()): UsageLine[] {
  return db
    .prepare(
      `SELECT u.name, u.role, u.monthly_budget_usd,
         COALESCE(SUM(CASE WHEN r.status IN ('completed','stale') THEN r.estimated_usd END),0) AS committed,
         COALESCE(SUM(CASE WHEN r.status IN (${openList}) THEN r.estimated_usd END),0) AS reserved,
         COALESCE(SUM(CASE WHEN r.status = 'completed' THEN 1 END),0) AS completed,
         COALESCE(SUM(CASE WHEN r.status IN ('failed','nsfw','rejected') THEN 1 END),0) AS failed
       FROM users u
       LEFT JOIN requests r ON r.user_id = u.id AND r.created_at >= ? AND r.created_at < ?
       GROUP BY u.id ORDER BY committed DESC`,
    )
    .all(monthStart(at), monthEnd(at)) as unknown as UsageLine[];
}
