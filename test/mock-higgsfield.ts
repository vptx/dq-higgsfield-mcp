/**
 * Local stand-in for api.higgsfield.ai used by the e2e test. Mirrors the documented contract:
 * POST /{model}, GET /requests/{id}/status, POST /requests/{id}/cancel, POST /estimate/{model}.
 */
import express from "express";
import { randomUUID } from "node:crypto";

export const MOCK_CREDS = "test-key-id:test-key-secret";

interface Job {
  id: string;
  model: string;
  input: Record<string, unknown>;
  polls: number;
  final?: "completed" | "failed" | "nsfw" | "canceled";
}

export function startMock(port: number) {
  const app = express();
  app.use(express.json());
  const jobs = new Map<string, Job>();
  const stats = { submits: 0 };

  app.use((req, res, next) => {
    if (req.path.startsWith("/media/")) return next();
    if (req.header("authorization") !== `Key ${MOCK_CREDS}`) {
      res.status(401).json({ detail: "bad key" });
      return;
    }
    next();
  });

  app.post(/^\/estimate\/(.+)$/, (req, res) => {
    const model = (req.params as unknown as string[])[0];
    if (model.startsWith("higgsfield-ai/soul")) {
      res.status(404).json({ detail: "no estimate" });
      return;
    }
    const prompt = String(req.body?.prompt ?? "");
    res.json({ usd: prompt.includes("expensive") ? "5.0" : "0.40" });
  });

  app.get("/requests/:id/status", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) {
      res.status(404).json({ detail: "not found" });
      return;
    }
    j.polls++;
    const base = { request_id: j.id, status_url: `http://127.0.0.1:${port}/requests/${j.id}/status`, cancel_url: `http://127.0.0.1:${port}/requests/${j.id}/cancel` };
    const prompt = String(j.input.prompt ?? "");
    if (!j.final) {
      if (prompt.includes("slow")) {
        res.json({ ...base, status: "queued" });
        return;
      }
      if (prompt.includes("nsfw")) j.final = "nsfw";
      else if (j.polls >= 2) j.final = "completed";
    }
    if (!j.final) {
      res.json({ ...base, status: j.polls === 1 ? "in_progress" : "queued" });
      return;
    }
    if (j.final === "completed") {
      const isVideo = j.model.includes("video");
      res.json({
        ...base,
        status: "completed",
        expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        ...(isVideo ? { video: { url: `http://127.0.0.1:${port}/media/${j.id}.mp4` } } : { images: [{ url: `http://127.0.0.1:${port}/media/${j.id}.png` }] }),
      });
      return;
    }
    res.json({ ...base, status: j.final });
  });

  app.post("/requests/:id/cancel", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j || j.final) {
      res.status(400).json({ detail: "cannot cancel" });
      return;
    }
    j.final = "canceled";
    res.status(202).json({ status: "canceled" });
  });

  app.get("/media/:file", (req, res) => {
    const isVideo = req.params.file.endsWith(".mp4");
    res.type(isVideo ? "video/mp4" : "image/png").send(Buffer.alloc(isVideo ? 4096 : 1024, 7));
  });

  app.post(/^\/(.+)$/, (req, res) => {
    const model = (req.params as unknown as string[])[0];
    if (!req.body?.prompt) {
      res.status(422).json({ detail: "prompt is required" });
      return;
    }
    stats.submits++;
    const id = randomUUID();
    jobs.set(id, { id, model, input: req.body, polls: 0 });
    res.json({ status: "queued", request_id: id, status_url: `http://127.0.0.1:${port}/requests/${id}/status`, cancel_url: `http://127.0.0.1:${port}/requests/${id}/cancel` });
  });

  const server = app.listen(port, "127.0.0.1");
  return { server, stats };
}
