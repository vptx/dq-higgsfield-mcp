/**
 * Local stand-in for api.elevenlabs.io used by the e2e test:
 * GET /v2/voices, POST /v1/text-to-speech/{voice_id}, POST /v1/sound-generation.
 */
import express from "express";

export const MOCK_EL_KEY = "test-elevenlabs-key";
export const MOCK_VOICE = "voice1234abcd";

export function startElevenLabsMock(port: number) {
  const app = express();
  app.use(express.json());
  const stats = { tts: 0, sfx: 0, lastTts: null as Record<string, unknown> | null };

  app.use((req, res, next) => {
    if (req.header("xi-api-key") !== MOCK_EL_KEY) {
      res.status(401).json({ detail: { status: "invalid_api_key", message: "bad key" } });
      return;
    }
    next();
  });

  app.get("/v2/voices", (req, res) => {
    const voices = [{ voice_id: MOCK_VOICE, name: "Rania", category: "premade", labels: { accent: "arabic" }, preview_url: null }];
    const q = String(req.query.search ?? "").toLowerCase();
    res.json({ voices: voices.filter((v) => !q || v.name.toLowerCase().includes(q) || v.labels.accent.includes(q)), has_more: false });
  });

  app.post("/v1/text-to-speech/:voice", (req, res) => {
    stats.tts++;
    stats.lastTts = { voice: req.params.voice, format: req.query.output_format, ...req.body };
    if (String(req.body?.text).includes("fail422")) {
      res.status(422).json({ detail: { status: "invalid_text", message: "text could not be processed" } });
      return;
    }
    res.type("audio/mpeg").send(Buffer.alloc(2048, 7));
  });

  app.post("/v1/sound-generation", (_req, res) => {
    stats.sfx++;
    res.type("audio/mpeg").send(Buffer.alloc(1024, 3));
  });

  const server = app.listen(port, "127.0.0.1");
  return { server, stats };
}
