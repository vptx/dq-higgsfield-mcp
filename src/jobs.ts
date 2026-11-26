import { config } from "./config.js";
import { log } from "./log.js";
import * as hf from "./higgsfield.js";
import {
  audit,
  db,
  FINAL_STATUSES,
  getRequest,
  openRequests,
  reserve,
  updateRequest,
  userMonthSpend,
  type RequestRow,
  type UserRow,
} from "./db.js";
import { findModel, type Model } from "./models.js";
import { archiveOutputs, archiveEnabled, signedFileUrl, type ArchivedFile } from "./archive.js";

export class UserFacingError extends Error {}

export interface JobView {
  id: string;
  request_id: string | null;
  model: string;
  project: string | null;
  status: string;
  estimated_usd: number;
  output_urls: string[];
  archived_links: string[];
  error: string | null;
  created_at: string;
  note?: string;
}

export function toView(r: RequestRow): JobView {
  const archived: ArchivedFile[] = r.archived_json ? JSON.parse(r.archived_json) : [];
  return {
    id: r.id,
    request_id: r.hf_request_id,
    model: r.model_id,
    project: r.project,
    status: r.status,
    estimated_usd: Number(r.estimated_usd.toFixed(4)),
    output_urls: r.output_urls_json ? JSON.parse(r.output_urls_json) : [],
    archived_links: archiveEnabled() && config.filesSecret ? archived.map((a) => signedFileUrl(r.id, a.index)) : [],
    error: r.error,
    created_at: r.created_at,
  };
}

export function budgetView(user: UserRow) {
  const s = userMonthSpend(user.id);
  return {
    monthly_budget_usd: user.monthly_budget_usd,
    used_usd: Number(s.committed.toFixed(4)),
    reserved_usd: Number(s.reserved.toFixed(4)),
    remaining_usd: Number(Math.max(0, user.monthly_budget_usd - s.committed - s.reserved).toFixed(4)),
  };
}

export function resolveModel(user: UserRow, modelId: string, customPath?: string): Model {
  if (customPath) {
    if (user.role !== "admin" || !config.allowCustomModelsForAdmins) {
      throw new UserFacingError("Only admins can call model paths outside the approved list. Pick a model from hf_list_models.");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(customPath) || customPath.includes("..")) {
      throw new UserFacingError("Invalid custom model path.");
    }
    return { id: `custom:${customPath}`, path: customPath, kind: "other", label: customPath, max_usd: 10 };
  }
  const m = findModel(modelId);
  if (!m) throw new UserFacingError(`Unknown or disabled model "${modelId}". Call hf_list_models for the approved list.`);
  return m;
}

export async function estimateCost(model: Model, input: Record<string, unknown>): Promise<{ usd: number; source: "higgsfield" | "ceiling" }> {
  const usd = await hf.estimate(model.path, input);
  if (usd === null) return { usd: model.max_usd, source: "ceiling" };
  if (usd > model.max_usd) {
    throw new UserFacingError(
      `Estimated cost $${usd.toFixed(3)} is above this model's per-generation ceiling of $${model.max_usd}. Lower duration/resolution, or ask an admin to raise max_usd.`,
    );
  }
  return { usd, source: "higgsfield" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate(
  user: UserRow,
  args: { model: Model; input: Record<string, unknown>; project?: string; waitSeconds: number },
): Promise<{ job: JobView; cost_source: string }> {
  const { model, input } = args;
  const est = await estimateCost(model, input);
  const reservation = reserve(user, {
    modelId: model.id,
    modelPath: model.path,
    input,
    project: args.project,
    estimatedUsd: est.usd,
  });
  if (!reservation.ok) throw new UserFacingError(reservation.detail);
  const row = reservation.request;

  let submitted: hf.HfStatus;
  try {
    submitted = await hf.submit(model.path, input);
  } catch (e) {
    updateRequest(row.id, { status: "rejected", error: (e as Error).message });
    audit(user.id, "generate.rejected", { id: row.id, model: model.id, error: (e as Error).message });
    throw new UserFacingError((e as Error).message);
  }
  if (!submitted?.request_id) {
    updateRequest(row.id, { status: "rejected", error: "No request_id in Higgsfield response" });
    throw new UserFacingError("Higgsfield did not return a request id.");
  }
  updateRequest(row.id, { hf_request_id: submitted.request_id, status: normalizeStatus(submitted.status) ?? "queued" });
  audit(user.id, "generate.submitted", { id: row.id, hf: submitted.request_id, model: model.id, usd: est.usd });
  log.info("generate.submitted", { user: user.name, model: model.id, id: row.id, usd: est.usd });

  const deadline = Date.now() + Math.min(args.waitSeconds, config.maxWaitSeconds) * 1000;
  let current = getRequest(row.id)!;
  while (Date.now() < deadline && !isFinal(current.status)) {
    await sleep(Math.min(3000, Math.max(250, deadline - Date.now())));
    current = await refresh(current, user.name);
  }
  const job = toView(current);
  if (!isFinal(current.status)) job.note = "Still generating. Call hf_get_status with this id in a little while.";
  return { job, cost_source: est.source };
}

const isFinal = (s: string) => (FINAL_STATUSES as readonly string[]).includes(s);

function normalizeStatus(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (s === "cancelled") return "canceled";
  return s;
}

const inflight = new Map<string, Promise<RequestRow>>();

/** Pulls the latest status from Higgsfield and persists it (deduplicated per request). */
export function refresh(row: RequestRow, userName?: string): Promise<RequestRow> {
  if (!row.hf_request_id || isFinal(row.status)) return Promise.resolve(row);
  const existing = inflight.get(row.id);
  if (existing) return existing;
  const p = (async () => {
    try {
      const s = await hf.getStatus(row.hf_request_id!);
      const status = normalizeStatus(s.status) ?? row.status;
      if (status === row.status && !isFinal(status)) {
        if (Date.now() - Date.parse(row.created_at) > config.staleAfterHours * 3600_000) {
          updateRequest(row.id, { status: "stale", error: "No final status from Higgsfield within the time limit." });
        }
        return getRequest(row.id)!;
      }
      if (status === "completed") {
        const urls = hf.extractOutputUrls(s);
        updateRequest(row.id, { status, output_urls_json: JSON.stringify(urls) });
        const name = userName ?? (db.prepare("SELECT name FROM users WHERE id = ?").get(row.user_id) as { name: string }).name;
        if (archiveEnabled() && urls.length) {
          const archived = await archiveOutputs(row.id, name, urls);
          updateRequest(row.id, { archived_json: JSON.stringify(archived) });
        }
        audit(row.user_id, "generate.completed", { id: row.id, outputs: urls.length });
      } else if (status === "failed" || status === "nsfw" || status === "canceled") {
        const msg =
          status === "nsfw" ? "Blocked by Higgsfield content moderation (not charged)." : status === "canceled" ? "Canceled (refunded)." : "Generation failed on Higgsfield (not charged).";
        updateRequest(row.id, { status, error: msg });
        audit(row.user_id, `generate.${status}`, { id: row.id });
      } else {
        updateRequest(row.id, { status });
      }
    } catch (e) {
      log.warn("refresh.failed", { id: row.id, error: String(e) });
    }
    return getRequest(row.id)!;
  })().finally(() => inflight.delete(row.id));
  inflight.set(row.id, p);
  return p;
}

export async function cancelJob(user: UserRow, row: RequestRow): Promise<JobView> {
  if (!row.hf_request_id) throw new UserFacingError("This request was never submitted.");
  if (row.status !== "queued") {
    throw new UserFacingError(`Only queued generations can be canceled (current status: ${row.status}).`);
  }
  try {
    await hf.cancel(row.hf_request_id);
  } catch (e) {
    throw new UserFacingError(`Cancel failed: ${(e as Error).message}`);
  }
  updateRequest(row.id, { status: "canceled", error: "Canceled by user (refunded)." });
  audit(user.id, "generate.canceled", { id: row.id });
  return toView(getRequest(row.id)!);
}

/** Background loop: finalizes open requests so budgets are released / committed even if nobody asks. */
export function startPoller(): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const rows = openRequests();
    for (const r of rows) await refresh(r);
    // rows stuck in "submitting" (crash between reserve and submit) are released after 10 minutes
    db.prepare(
      `UPDATE requests SET status='rejected', error='Submission did not complete', updated_at=? WHERE status='submitting' AND hf_request_id IS NULL AND created_at < ?`,
    ).run(new Date().toISOString(), new Date(Date.now() - 10 * 60_000).toISOString());
    if (!stopped) timer = setTimeout(tick, config.pollIntervalMs);
  };
  let timer = setTimeout(tick, config.pollIntervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
