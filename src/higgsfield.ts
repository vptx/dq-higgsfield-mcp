import { config } from "./config.js";

/**
 * Thin client for the Higgsfield REST API (https://api.higgsfield.ai).
 *  - Auth:    Authorization: Key KEY_ID:KEY_SECRET
 *  - Submit:  POST /{model_path}             -> { request_id, status_url, cancel_url, status }
 *  - Status:  GET  /requests/{id}/status     -> { status, images?: [{url}], video?: {url}, ... }
 *  - Cancel:  POST /requests/{id}/cancel     (only while queued)
 *  - Estimate POST /estimate/{model_path}    -> { usd: "0.094" }
 * Statuses: queued | in_progress | completed | failed | nsfw (failed/nsfw are not charged).
 */

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export interface HfStatus {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled" | string;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  expires_at?: string;
  [k: string]: unknown;
}

const UA = "bc-higgsfield-mcp/1.0";

async function call(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Key ${config.hfCredentials}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
  };
  if (config.hfExpiresAfter && method === "POST" && !path.startsWith("/estimate/")) {
    headers["Hf-Expires-After"] = config.hfExpiresAfter;
  }
  const res = await fetch(config.hfBaseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const detail =
      (data && typeof data === "object" && ("detail" in data || "message" in data || "error" in data)
        ? JSON.stringify((data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error)
        : String(text).slice(0, 300)) || res.statusText;
    const friendly =
      res.status === 401
        ? "Higgsfield rejected the server's API key (401). An admin must check HF_CREDENTIALS."
        : res.status === 402 || res.status === 403
          ? "Higgsfield API balance is too low or access is denied. An admin must top up the balance at console.higgsfield.ai."
          : res.status === 422 || res.status === 400
            ? `Higgsfield rejected the input: ${detail}`
            : res.status === 429
              ? "Higgsfield rate limit reached (20 concurrent per key). Try again shortly."
              : `Higgsfield API error ${res.status}: ${detail}`;
    throw new HiggsfieldError(friendly, res.status, data);
  }
  return data;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function submit(modelPath: string, input: Record<string, unknown>): Promise<HfStatus> {
  return (await call("POST", "/" + enc(modelPath), input)) as HfStatus;
}

export async function getStatus(requestId: string): Promise<HfStatus> {
  return (await call("GET", `/requests/${encodeURIComponent(requestId)}/status`, undefined, 30_000)) as HfStatus;
}

export async function cancel(requestId: string): Promise<unknown> {
  return call("POST", `/requests/${encodeURIComponent(requestId)}/cancel`, undefined, 30_000);
}

/** Returns the estimated cost in USD, or null if the estimate endpoint is not available for this model. */
export async function estimate(modelPath: string, input: Record<string, unknown>): Promise<number | null> {
  try {
    const data = (await call("POST", "/estimate/" + enc(modelPath), input, 20_000)) as { usd?: string | number };
    const usd = Number(data?.usd);
    return Number.isFinite(usd) && usd >= 0 ? usd : null;
  } catch (e) {
    if (e instanceof HiggsfieldError && (e.httpStatus === 404 || e.httpStatus === 405 || e.httpStatus >= 500)) return null;
    throw e;
  }
}

/** Collects every output media URL from a status payload (images[], video, audio, outputs...). */
export function extractOutputUrls(s: unknown): string[] {
  const out: string[] = [];
  const skip = new Set(["status_url", "cancel_url"]);
  const walk = (v: unknown, key?: string) => {
    if (!v) return;
    if (typeof v === "string") {
      if (key === "url" && /^https?:\/\//.test(v)) out.push(v);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key === "url" ? "url" : undefined));
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (skip.has(k)) continue;
        walk(val, k);
      }
    }
  };
  walk(s);
  return [...new Set(out)];
}
