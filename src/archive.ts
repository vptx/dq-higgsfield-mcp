import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { log } from "./log.js";

export const archiveEnabled = () => Boolean(config.archiveDir);

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

export interface ArchivedFile {
  index: number;
  file: string; // relative to archiveDir
  bytes: number;
  source_url: string;
}

/** Downloads each output into ARCHIVE_DIR/<user>/<yyyy-mm>/<requestId>_<n>.<ext>. */
export async function archiveOutputs(requestId: string, userName: string, urls: string[]): Promise<ArchivedFile[]> {
  if (!archiveEnabled()) return [];
  const month = new Date().toISOString().slice(0, 7);
  const safeUser = userName.replace(/[^A-Za-z0-9._-]/g, "_");
  const relDir = join(safeUser, month);
  const absDir = resolve(config.archiveDir, relDir);
  mkdirSync(absDir, { recursive: true });
  const out: ArchivedFile[] = [];
  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      let ext = MIME_EXT[ct] ?? extname(new URL(url).pathname).slice(0, 6);
      if (!/^\.[a-z0-9]{2,5}$/i.test(ext)) ext = ".bin";
      const rel = join(relDir, `${requestId}_${i}${ext}`);
      const abs = resolve(config.archiveDir, rel);
      let bytes = 0;
      const counter = new TransformCounter((n) => (bytes += n));
      await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(abs));
      out.push({ index: i, file: rel, bytes, source_url: url });
    } catch (e) {
      log.warn("archive.failed", { requestId, index: i, error: String(e) });
    }
  }
  return out;
}

class TransformCounter extends Transform {
  constructor(private onBytes: (n: number) => void) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.onBytes(chunk.length);
    cb(null, chunk);
  }
}

/* -------- signed download links: /files/<requestId>/<index>?exp=<unix>&sig=<hmac> -------- */

function sign(requestId: string, index: number, exp: number): string {
  return createHmac("sha256", config.filesSecret).update(`${requestId}/${index}/${exp}`).digest("base64url");
}

export function signedFileUrl(requestId: string, index: number): string {
  const exp = Math.floor(Date.now() / 1000) + config.fileLinkTtlDays * 86400;
  return `${config.publicBaseUrl}/files/${requestId}/${index}?exp=${exp}&sig=${sign(requestId, index, exp)}`;
}

export function verifyFileSig(requestId: string, index: number, exp: number, sig: string): boolean {
  if (!config.filesSecret || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(requestId, index, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function archivedAbsPath(rel: string): string | null {
  const root = resolve(config.archiveDir);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + "/") && abs !== root) return null;
  return existsSync(abs) ? abs : null;
}
