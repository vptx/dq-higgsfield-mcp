import { config } from "./config.js";

/** USD per 1,000 characters (elevenlabs.io/pricing/api). Unknown models are rejected rather than guessed. */
export const TTS_MODELS: Record<string, { label: string; usdPer1k: number; maxChars: number }> = {
  eleven_multilingual_v2: { label: "Multilingual v2 (default, best for Arabic)", usdPer1k: 0.08, maxChars: 10_000 },
  eleven_v3: { label: "Eleven v3 (most expressive)", usdPer1k: 0.08, maxChars: 5_000 },
  eleven_flash_v2_5: { label: "Flash v2.5 (fast, cheaper)", usdPer1k: 0.04, maxChars: 40_000 },
  eleven_turbo_v2_5: { label: "Turbo v2.5 (fast, cheaper)", usdPer1k: 0.04, maxChars: 40_000 },
};
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
/** Sound effects: USD per minute of generated audio. */
export const SFX_USD_PER_MIN = 0.12;

const OUTPUT_FORMAT = "mp3_44100_128";

export class ElevenLabsError extends Error {}

async function call(path: string, init: { method: string; body?: unknown; accept?: string }, timeoutMs = 120_000): Promise<Response> {
  const res = await fetch(config.elevenlabsBaseUrl + path, {
    method: init.method,
    headers: {
      "xi-api-key": config.elevenlabsApiKey,
      "Content-Type": "application/json",
      Accept: init.accept ?? "application/json",
      "User-Agent": "bc-ai-gateway/1.0",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.ok) return res;
  const text = await res.text();
  let detail = text.slice(0, 300);
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    const d = j.detail as { message?: string } | string | undefined;
    detail = typeof d === "string" ? d : (d?.message ?? JSON.stringify(j.detail ?? j).slice(0, 300));
  } catch {
    /* keep text */
  }
  throw new ElevenLabsError(
    res.status === 401
      ? "ElevenLabs rejected the server's API key (401). An admin must check ELEVENLABS_API_KEY."
      : res.status === 402 || res.status === 403
        ? `ElevenLabs refused the request (${res.status}): quota or plan limit. An admin must check the ElevenLabs account. ${detail}`
        : res.status === 422 || res.status === 400
          ? `ElevenLabs rejected the input: ${detail}`
          : res.status === 429
            ? "ElevenLabs is rate limiting the team right now. Try again in a minute."
            : `ElevenLabs error ${res.status}: ${detail}`,
  );
}

async function audio(res: Response): Promise<{ data: Buffer; contentType: string }> {
  const contentType = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim();
  return { data: Buffer.from(await res.arrayBuffer()), contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg" };
}

export async function textToSpeech(args: {
  voiceId: string;
  text: string;
  modelId: string;
  languageCode?: string;
  voiceSettings?: Record<string, unknown>;
}): Promise<{ data: Buffer; contentType: string }> {
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    accept: "audio/mpeg",
    body: {
      text: args.text,
      model_id: args.modelId,
      ...(args.languageCode ? { language_code: args.languageCode } : {}),
      ...(args.voiceSettings ? { voice_settings: args.voiceSettings } : {}),
    },
  });
  return audio(res);
}

export async function soundEffect(args: { text: string; durationSeconds: number; promptInfluence?: number; loop?: boolean }) {
  const res = await call(`/v1/sound-generation?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    accept: "audio/mpeg",
    body: {
      text: args.text,
      duration_seconds: args.durationSeconds,
      ...(args.promptInfluence !== undefined ? { prompt_influence: args.promptInfluence } : {}),
      ...(args.loop !== undefined ? { loop: args.loop } : {}),
    },
  });
  return audio(res);
}

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string | null;
}

export async function listVoices(args: { search?: string; pageSize: number }): Promise<Voice[]> {
  const q = new URLSearchParams({ page_size: String(args.pageSize), include_total_count: "false" });
  if (args.search) q.set("search", args.search);
  const res = await call(`/v2/voices?${q}`, { method: "GET" }, 30_000);
  const body = (await res.json()) as { voices?: Voice[] };
  return (body.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels, preview_url: v.preview_url }));
}
