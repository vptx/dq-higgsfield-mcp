import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env loader (no dependency). Real environment variables win. */
function loadDotEnv(path = ".env"): void {
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  /** "KEY_ID:KEY_SECRET" from console.higgsfield.ai — never leaves the server. */
  hfCredentials: process.env.HF_CREDENTIALS ?? "",
  hfBaseUrl: (process.env.HF_BASE_URL ?? "https://api.higgsfield.ai").replace(/\/+$/, ""),
  /** Optional upstream retention, sent as Hf-Expires-After (e.g. "24h"). Empty = Higgsfield default (7 days). */
  hfExpiresAfter: process.env.HF_EXPIRES_AFTER ?? "",

  port: num("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  /** Public HTTPS origin, used to print connector URLs and archived-file links. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, ""),

  dbPath: process.env.DB_PATH ?? "./data/bc-higgsfield.sqlite",
  modelsFile: process.env.MODELS_FILE ?? "./models.json",
  /** Where finished outputs are copied (Higgsfield deletes them after 7 days). Empty disables archiving. */
  archiveDir: process.env.ARCHIVE_DIR ?? "./data/outputs",
  /** HMAC secret for signed archive links. Required if archiving is on. */
  filesSecret: process.env.FILES_SECRET ?? "",
  fileLinkTtlDays: num("FILE_LINK_TTL_DAYS", 30),

  /** Higgsfield allows 20 concurrent requests per key. Keep a little headroom. */
  globalConcurrency: num("GLOBAL_CONCURRENCY", 18),
  defaultUserConcurrency: num("DEFAULT_USER_CONCURRENCY", 3),
  defaultMonthlyBudgetUsd: num("DEFAULT_MONTHLY_BUDGET_USD", 50),
  /** Optional hard ceiling for the whole team per calendar month (0 = off). */
  orgMonthlyBudgetUsd: num("ORG_MONTHLY_BUDGET_USD", 0),

  /** Allow admins (only) to call model paths that are not in models.json. */
  allowCustomModelsForAdmins: bool("ALLOW_CUSTOM_MODELS_FOR_ADMINS", true),

  pollIntervalMs: num("POLL_INTERVAL_MS", 10_000),
  /** Max seconds a single hf_generate call waits before returning a request id. */
  maxWaitSeconds: num("MAX_WAIT_SECONDS", 50),
  /** Stop polling (and mark "stale") after this many hours without a final status. */
  staleAfterHours: num("STALE_AFTER_HOURS", 6),

  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
};

export function assertServerConfig(): void {
  const problems: string[] = [];
  if (!/^[^:\s]+:[^:\s]+$/.test(config.hfCredentials)) {
    problems.push('HF_CREDENTIALS must be "KEY_ID:KEY_SECRET" (from console.higgsfield.ai)');
  }
  if (config.archiveDir && config.filesSecret.length < 32) {
    problems.push("FILES_SECRET must be at least 32 characters when ARCHIVE_DIR is set (or set ARCHIVE_DIR= to disable archiving)");
  }
  if (problems.length) {
    throw new Error("Configuration error:\n - " + problems.join("\n - "));
  }
}
