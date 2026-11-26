import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { audit, getRequest, reserve, updateRequest, type UserRow } from "../db.js";
import { budgetView, toView, UserFacingError, type JobView } from "../jobs.js";
import { archiveBuffer, archiveEnabled } from "../archive.js";
import * as el from "../elevenlabs.js";
import { log } from "../log.js";
import { ok, wrap } from "../tool-kit.js";

export const elevenlabsInstructions =
  "ElevenLabs (voice/audio): call el_list_voices to find a voice_id (never invent one), then el_text_to_speech. " +
  "Cost is per character, so don't regenerate long scripts without being asked. el_sound_effect makes short sound effects. " +
  "Audio comes back as archived_links (download links) — share those with the user.";

const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const round = (n: number) => Math.max(0.0001, Number(n.toFixed(4)));

/** Reserve → call → archive. Failed calls are released from the budget (ElevenLabs doesn't bill them). */
async function runPaid(
  user: UserRow,
  a: { modelId: string; modelPath: string; input: Record<string, unknown>; project?: string; usd: number; run: () => Promise<{ data: Buffer; contentType: string }> },
): Promise<JobView> {
  if (!archiveEnabled() || !config.filesSecret) {
    throw new UserFacingError("Audio needs file archiving on the server (ARCHIVE_DIR + FILES_SECRET). Ask an admin.");
  }
  const r = reserve(user, { service: "elevenlabs", modelId: a.modelId, modelPath: a.modelPath, input: a.input, project: a.project, estimatedUsd: a.usd });
  if (!r.ok) throw new UserFacingError(r.detail);
  const id = r.request.id;
  try {
    const out = await a.run();
    const file = archiveBuffer(id, user.name, 0, out.data, out.contentType);
    updateRequest(id, { status: "completed", output_urls_json: "[]", archived_json: JSON.stringify([file]) });
    audit(user.id, "generate.completed", { id, service: "elevenlabs", model: a.modelId, usd: a.usd, bytes: out.data.length });
    log.info("generate.completed", { user: user.name, service: "elevenlabs", model: a.modelId, id, usd: a.usd });
  } catch (e) {
    const msg = e instanceof el.ElevenLabsError ? e.message : "The ElevenLabs request failed. The admin can see details in the server log.";
    if (!(e instanceof el.ElevenLabsError)) log.error("elevenlabs.error", { id, error: String(e) });
    updateRequest(id, { status: "rejected", error: msg });
    audit(user.id, "generate.rejected", { id, service: "elevenlabs", model: a.modelId, error: msg });
    throw new UserFacingError(msg);
  }
  return toView(getRequest(id)!);
}

export function registerElevenLabs(server: McpServer, user: UserRow): void {
  server.registerTool(
    "el_list_voices",
    {
      title: "Find ElevenLabs voices",
      description: "Searches the voices available on the team's ElevenLabs account (name, accent, gender, language). Free. Also lists the text-to-speech models and their prices.",
      inputSchema: {
        search: z.string().max(80).optional().describe("Optional search text, e.g. 'arabic', 'male narrator', 'Rachel'"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "el_list_voices", async ({ search, limit }: { search?: string; limit?: number }) => {
      let voices: el.Voice[];
      try {
        voices = await el.listVoices({ search, pageSize: limit ?? 20 });
      } catch (e) {
        if (e instanceof el.ElevenLabsError) throw new UserFacingError(e.message);
        throw e;
      }
      return ok({
        voices,
        models: Object.entries(el.TTS_MODELS).map(([id, m]) => ({ id, label: m.label, usd_per_1000_chars: m.usdPer1k, max_chars: Math.min(m.maxChars, config.elevenlabsMaxChars) })),
        default_model: el.DEFAULT_TTS_MODEL,
      });
    }),
  );

  server.registerTool(
    "el_text_to_speech",
    {
      title: "Text to speech with ElevenLabs",
      description: "Turns text into an MP3 voice-over, charged per character to your monthly budget. Returns a download link.",
      inputSchema: {
        text: z.string().min(1).describe("The script to speak"),
        voice_id: z.string().describe("voice_id from el_list_voices"),
        model: z.string().optional().describe(`Model id from el_list_voices. Default: ${el.DEFAULT_TTS_MODEL}`),
        language_code: z.string().regex(/^[a-z]{2,3}$/).optional().describe("Optional ISO 639-1 code to force a language, e.g. 'ar'"),
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
        project: z.string().max(80).optional().describe("Optional client/project tag for reporting"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    wrap(
      user,
      "el_text_to_speech",
      async (a: { text: string; voice_id: string; model?: string; language_code?: string; stability?: number; similarity_boost?: number; style?: number; speed?: number; project?: string }) => {
        const modelId = a.model ?? el.DEFAULT_TTS_MODEL;
        const model = el.TTS_MODELS[modelId];
        if (!model) throw new UserFacingError(`Unknown model "${modelId}". Use one of: ${Object.keys(el.TTS_MODELS).join(", ")}.`);
        if (!VOICE_ID.test(a.voice_id)) throw new UserFacingError("Invalid voice_id. Get one from el_list_voices.");
        const max = Math.min(model.maxChars, config.elevenlabsMaxChars);
        if (a.text.length > max) throw new UserFacingError(`Text is ${a.text.length} characters; the limit for ${modelId} here is ${max}. Split it into parts.`);
        const settings = Object.fromEntries(
          Object.entries({ stability: a.stability, similarity_boost: a.similarity_boost, style: a.style, speed: a.speed }).filter(([, v]) => v !== undefined),
        );
        const usd = round((a.text.length / 1000) * model.usdPer1k);
        const job = await runPaid(user, {
          modelId,
          modelPath: `text-to-speech/${a.voice_id}`,
          input: { text: a.text, voice_id: a.voice_id, model_id: modelId, language_code: a.language_code, voice_settings: settings },
          project: a.project,
          usd,
          run: () => el.textToSpeech({ voiceId: a.voice_id, text: a.text, modelId, languageCode: a.language_code, voiceSettings: Object.keys(settings).length ? settings : undefined }),
        });
        return ok({ job, characters: a.text.length, budget: budgetView(user) });
      },
    ),
  );

  server.registerTool(
    "el_sound_effect",
    {
      title: "Sound effect with ElevenLabs",
      description: `Generates a short sound effect from a description (0.5–30 s), charged at $${el.SFX_USD_PER_MIN}/minute to your monthly budget. Returns a download link.`,
      inputSchema: {
        prompt: z.string().min(1).max(450).describe("What it should sound like, e.g. 'heavy rain on a tin roof'"),
        duration_seconds: z.number().min(0.5).max(30).describe("Length in seconds"),
        prompt_influence: z.number().min(0).max(1).optional().describe("How literally to follow the prompt (default 0.3)"),
        loop: z.boolean().optional().describe("Make it loop seamlessly"),
        project: z.string().max(80).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    wrap(user, "el_sound_effect", async (a: { prompt: string; duration_seconds: number; prompt_influence?: number; loop?: boolean; project?: string }) => {
      const usd = round((a.duration_seconds / 60) * el.SFX_USD_PER_MIN);
      const job = await runPaid(user, {
        modelId: "sound-effects",
        modelPath: "sound-generation",
        input: { text: a.prompt, duration_seconds: a.duration_seconds, prompt_influence: a.prompt_influence, loop: a.loop },
        project: a.project,
        usd,
        run: () => el.soundEffect({ text: a.prompt, durationSeconds: a.duration_seconds, promptInfluence: a.prompt_influence, loop: a.loop }),
      });
      return ok({ job, budget: budgetView(user) });
    }),
  );
}
