/**
 * End-to-end test: mock Higgsfield upstream + the real gateway + the official MCP client.
 * Run: npm test
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMock, MOCK_CREDS } from "./mock-higgsfield.js";
import { startElevenLabsMock, MOCK_EL_KEY, MOCK_VOICE } from "./mock-elevenlabs.js";

const MOCK_PORT = 9911;
const GW_PORT = 9912;
const EL_PORT = 9913;
const ADMIN_PASSWORD = "e2e-admin-password-123";
const dir = mkdtempSync(join(tmpdir(), "dqhf-"));
const env = {
  ...process.env,
  HF_CREDENTIALS: MOCK_CREDS,
  HF_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  ELEVENLABS_API_KEY: MOCK_EL_KEY,
  ELEVENLABS_BASE_URL: `http://127.0.0.1:${EL_PORT}`,
  ADMIN_PASSWORD,
  PORT: String(GW_PORT),
  HOST: "127.0.0.1",
  PUBLIC_BASE_URL: `http://127.0.0.1:${GW_PORT}`,
  DB_PATH: join(dir, "db.sqlite"),
  ARCHIVE_DIR: join(dir, "outputs"),
  FILES_SECRET: "x".repeat(40),
  POLL_INTERVAL_MS: "300",
  MAX_WAIT_SECONDS: "15",
  LOG_LEVEL: "warn",
  NODE_NO_WARNINGS: "1",
};

let passed = 0;
let failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) {
    passed++;
    console.log("  ✔ " + name);
  } else {
    failed++;
    console.log("  ✖ " + name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
}

// Run tsx through node directly so the test also works on Windows (no .cmd shim / shell needed).
const tsxCli = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
function admin(...args: string[]): string {
  return execFileSync(process.execPath, [tsxCli, "src/admin.ts", ...args], { env, encoding: "utf8" });
}
async function adminApi(method: string, path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:${GW_PORT}/admin/api${path}`, {
    method,
    headers: { authorization: `Bearer ${ADMIN_PASSWORD}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}
function addUser(name: string, ...flags: string[]): string {
  const out = admin("user:add", name, ...flags);
  const m = out.match(/Bearer token:\s+(bc_\S+)/);
  if (!m) throw new Error("no token in: " + out);
  return m[1];
}

async function connect(token: string, viaHeader = false) {
  const url = viaHeader ? new URL(`http://127.0.0.1:${GW_PORT}/mcp`) : new URL(`http://127.0.0.1:${GW_PORT}/mcp/u/${token}`);
  const transport = new StreamableHTTPClientTransport(url, viaHeader ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined);
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type R = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: any };
async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<R> {
  return (await c.callTool({ name, arguments: args })) as R;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${GW_PORT}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("gateway did not start");
}

let gw: ChildProcess | undefined;
const mock = startMock(MOCK_PORT);
const elMock = startElevenLabsMock(EL_PORT);

try {
  const tAdmin = addUser("yazan", "--admin", "--budget", "100");
  const tSara = addUser("sara", "--budget", "1", "--concurrency", "1", "--services", "higgsfield");
  const tOmar = addUser("omar", "--budget", "10", "--services", "higgsfield");

  gw = spawn(process.execPath, [tsxCli, "src/server.ts"], { env, stdio: ["ignore", "inherit", "inherit"] });
  await waitHealthy();

  console.log("\nAuth");
  const bad = await fetch(`http://127.0.0.1:${GW_PORT}/mcp/u/bc_nope`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  check("invalid token → 401", bad.status === 401);

  const admin_ = await connect(tAdmin);
  const sara = await connect(tSara);
  const omar = await connect(tOmar, true);
  check("Bearer header auth works", true);

  console.log("\nTools");
  const saraTools = (await sara.listTools()).tools.map((t) => t.name);
  const adminTools = (await admin_.listTools()).tools.map((t) => t.name);
  check("Higgsfield-only member sees 7 tools, no admin or ElevenLabs tool", saraTools.length === 7 && !saraTools.includes("admin_team_usage") && !saraTools.some((t) => t.startsWith("el_")), saraTools);
  check("admin (all services) also sees admin_team_usage + ElevenLabs tools", adminTools.includes("admin_team_usage") && adminTools.includes("el_text_to_speech"), adminTools);

  const models = await call(sara, "hf_list_models");
  check("hf_list_models returns 3 models", models.structuredContent?.models?.length === 3, models);

  const est = await call(sara, "hf_estimate_cost", { model: "seedance-2-t2v", input: { prompt: "coast" } });
  check("estimate = $0.40 from Higgsfield", est.structuredContent?.estimated_usd === 0.4, est);

  console.log("\nGenerate + archive");
  const g1 = await call(sara, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "coast road", duration: 5 }, project: "test" });
  const job1 = g1.structuredContent?.job;
  check("generation completes within wait", job1?.status === "completed", g1);
  check("output URL returned", job1?.output_urls?.length === 1);
  check("archived link returned", job1?.archived_links?.length === 1);
  const fileRes = await fetch(job1.archived_links[0]);
  const bytes = (await fileRes.arrayBuffer()).byteLength;
  check("archived file downloads (4096 bytes, video/mp4)", fileRes.status === 200 && bytes === 4096 && fileRes.headers.get("content-type")?.includes("video/mp4"), { status: fileRes.status, bytes });
  const tampered = await fetch(job1.archived_links[0].replace(/sig=./, "sig=A"));
  check("tampered link → 403", tampered.status === 403);
  check("budget used = 0.40", g1.structuredContent?.budget?.used_usd === 0.4, g1.structuredContent?.budget);

  console.log("\nBudget");
  const g2 = await call(sara, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "second" } });
  check("second generation ok (0.80 of 1.00)", g2.structuredContent?.job?.status === "completed", g2);
  const submitsBefore = mock.stats.submits;
  const g3 = await call(sara, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "third" } });
  check("third generation refused: over budget", g3.isError && g3.content[0].text.includes("Monthly budget exceeded"), g3);
  check("refused generation never reached Higgsfield", mock.stats.submits === submitsBefore);

  const exp = await call(omar, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "expensive epic" } });
  check("estimate above model ceiling refused", exp.isError && exp.content[0].text.includes("ceiling"), exp);

  const soul = await call(omar, "hf_generate", { model: "soul-2-standard", input: { prompt: "portrait" } });
  check("no estimate → reserved at model ceiling ($0.25)", soul.structuredContent?.job?.estimated_usd === 0.25 && soul.structuredContent?.cost_basis?.includes("ceiling"), soul);

  console.log("\nModeration / failures are free");
  const before = (await call(omar, "my_budget")).structuredContent.budget.used_usd;
  const ns = await call(omar, "hf_generate", { model: "flux-kontext-max-t2i", input: { prompt: "nsfw thing" } });
  check("nsfw status surfaced", ns.structuredContent?.job?.status === "nsfw", ns);
  const after = (await call(omar, "my_budget")).structuredContent.budget.used_usd;
  check("nsfw not charged to budget", before === after, { before, after });

  const badInput = await call(omar, "hf_generate", { model: "flux-kontext-max-t2i", input: { aspect_ratio: "1:1" } });
  check("422 from Higgsfield surfaced as readable error", badInput.isError && badInput.content[0].text.includes("rejected the input"), badInput);
  const afterBad = (await call(omar, "my_budget")).structuredContent.budget;
  check("rejected submission releases reservation", afterBad.reserved_usd === 0 && afterBad.used_usd === after, afterBad);

  console.log("\nIsolation");
  const peek = await call(omar, "hf_get_status", { id: job1.id });
  check("member cannot read another member's generation", peek.isError, peek);
  const adminPeek = await call(admin_, "hf_get_status", { id: job1.id });
  check("admin can read any generation", adminPeek.structuredContent?.job?.id === job1.id);
  const hist = await call(sara, "my_history", { project: "test" });
  check("history filtered by project", hist.structuredContent?.jobs?.length === 1, hist);

  console.log("\nConcurrency + cancel");
  await call(admin_, "my_budget");
  admin("user:budget", "sara", "5");
  const slow = await call(sara, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "slow render" }, wait_seconds: 0 });
  check("wait_seconds=0 returns immediately with id", ["queued", "submitting"].includes(slow.structuredContent?.job?.status), slow);
  const blocked = await call(sara, "hf_generate", { model: "seedance-2-t2v", input: { prompt: "another" }, wait_seconds: 0 });
  check("per-user concurrency limit enforced", blocked.isError && blocked.content[0].text.includes("already have 1"), blocked);
  const cancelled = await call(sara, "hf_cancel", { id: slow.structuredContent.job.id });
  check("cancel queued generation", cancelled.structuredContent?.job?.status === "canceled", cancelled);
  check("canceled generation refunded", cancelled.structuredContent?.budget?.reserved_usd === 0, cancelled.structuredContent?.budget);

  console.log("\nAdmin");
  const custom = await call(sara, "hf_generate", { model: "x", custom_model_path: "kling/v3/text-to-video", input: { prompt: "a" } });
  check("member cannot use custom model path", custom.isError);
  const usage = await call(admin_, "admin_team_usage");
  check("team usage report lists 3 members", usage.structuredContent?.members?.length === 3, usage);
  admin("user:disable", "omar");
  let disabledOk = false;
  try {
    const o2 = await connect(tOmar);
    await o2.listTools();
  } catch {
    disabledOk = true;
  }
  check("disabled user is locked out immediately", disabledOk);
  const report = admin("usage");
  check("CLI usage report prints", report.includes("sara") && report.includes("Team total"));

  console.log("\nBackground poller");
  admin("user:enable", "omar");
  const omar2 = await connect(tOmar);
  const bg = await call(omar2, "hf_generate", { model: "flux-kontext-max-t2i", input: { prompt: "bg job" }, wait_seconds: 0 });
  await sleep(2500);
  const bgHist = await call(omar2, "my_history", { limit: 1 });
  check("poller finalizes jobs nobody is waiting on", bgHist.structuredContent?.jobs?.[0]?.id === bg.structuredContent?.job?.id && bgHist.structuredContent?.jobs?.[0]?.status === "completed", bgHist);

  console.log("\nElevenLabs");
  const voices = await call(admin_, "el_list_voices", { search: "arabic" });
  check("el_list_voices returns voices + priced models", voices.structuredContent?.voices?.[0]?.voice_id === MOCK_VOICE && voices.structuredContent?.models?.length === 4, voices);
  const usedBefore = (await call(admin_, "my_budget")).structuredContent.budget.used_usd;
  const tts = await call(admin_, "el_text_to_speech", { text: "م".repeat(1000), voice_id: MOCK_VOICE, language_code: "ar", project: "voice" });
  const ttsJob = tts.structuredContent?.job;
  check("TTS completes and is priced per character ($0.08 / 1k chars)", ttsJob?.status === "completed" && ttsJob?.service === "elevenlabs" && ttsJob?.estimated_usd === 0.08, tts);
  check("TTS sent model, language and mp3 format upstream", elMock.stats.lastTts?.model_id === "eleven_multilingual_v2" && elMock.stats.lastTts?.language_code === "ar" && elMock.stats.lastTts?.format === "mp3_44100_128", elMock.stats.lastTts);
  const audioRes = await fetch(ttsJob.archived_links[0]);
  const audioBytes = (await audioRes.arrayBuffer()).byteLength;
  check("TTS audio downloads from signed link (2048 bytes, audio/mpeg)", audioRes.status === 200 && audioBytes === 2048 && audioRes.headers.get("content-type")?.includes("audio/mpeg"), { status: audioRes.status, audioBytes });
  check("TTS charged to the shared budget", (await call(admin_, "my_budget")).structuredContent.budget.used_usd === Number((usedBefore + 0.08).toFixed(4)));

  const ttsBefore = elMock.stats.tts;
  const badVoice = await call(admin_, "el_text_to_speech", { text: "hi", voice_id: "../../x" });
  check("invalid voice_id refused before reaching ElevenLabs", badVoice.isError && elMock.stats.tts === ttsBefore, badVoice);
  const badModel = await call(admin_, "el_text_to_speech", { text: "hi", voice_id: MOCK_VOICE, model: "made_up" });
  check("unknown TTS model refused", badModel.isError && badModel.content[0].text.includes("Unknown model"), badModel);
  const reservedBefore = (await call(admin_, "my_budget")).structuredContent.budget;
  const el422 = await call(admin_, "el_text_to_speech", { text: "fail422 please", voice_id: MOCK_VOICE });
  const reservedAfter = (await call(admin_, "my_budget")).structuredContent.budget;
  check("ElevenLabs 422 surfaced readably and not charged", el422.isError && el422.content[0].text.includes("rejected the input") && reservedAfter.used_usd === reservedBefore.used_usd && reservedAfter.reserved_usd === 0, { el422, reservedAfter });

  const sfx = await call(admin_, "el_sound_effect", { prompt: "rain on a tin roof", duration_seconds: 15 });
  check("sound effect priced by duration ($0.12/min → 15s = $0.03)", sfx.structuredContent?.job?.status === "completed" && sfx.structuredContent?.job?.estimated_usd === 0.03, sfx);
  const elHist = await call(admin_, "my_history", { project: "voice" });
  check("my_history includes ElevenLabs jobs with service tag", elHist.structuredContent?.jobs?.[0]?.service === "elevenlabs", elHist);

  console.log("\nService access");
  admin("user:services", "yazan", "higgsfield");
  const admin2 = await connect(tAdmin);
  const admin2Tools = (await admin2.listTools()).tools.map((t) => t.name);
  check("revoking a service removes its tools on the same link", !admin2Tools.some((t) => t.startsWith("el_")) && admin2Tools.includes("hf_generate"), admin2Tools);
  admin("user:services", "yazan", "higgsfield,elevenlabs");

  const ov = await adminApi("GET", "/overview");
  const elSvc = ov.body.services?.find((s: any) => s.id === "elevenlabs");
  check("admin overview lists services with per-service spend", elSvc?.configured === true && elSvc?.spent === 0.11, ov.body.services);
  const created = await adminApi("POST", "/users", { name: "voice-only", budget: 5, services: ["elevenlabs"] });
  check("admin API creates a member with chosen services", created.status === 201 && created.body.token?.startsWith("bc_"), created);
  const vo = await connect(created.body.token);
  const voTools = (await vo.listTools()).tools.map((t) => t.name);
  check("ElevenLabs-only member gets only el_* + shared tools", voTools.includes("el_text_to_speech") && !voTools.some((t) => t.startsWith("hf_")), voTools);
  const badSvc = await adminApi("POST", "/users", { name: "x1", services: ["openai"] });
  check("unknown service rejected by admin API", badSvc.status === 400, badSvc);
  const voId = ov.body.users ? (await adminApi("GET", "/overview")).body.users.find((u: any) => u.name === "voice-only").id : "";
  const patched = await adminApi("PATCH", `/users/${voId}`, { services: [] });
  const vo2 = await connect(created.body.token);
  const vo2Tools = (await vo2.listTools()).tools.map((t) => t.name);
  check("removing all services leaves only shared tools", patched.status === 200 && vo2Tools.every((t) => !t.startsWith("el_") && !t.startsWith("hf_")), vo2Tools);

  for (const c of [admin_, sara, omar, omar2, admin2, vo, vo2]) await c.close().catch(() => {});
} catch (e) {
  failed++;
  console.error("Test crashed:", e);
} finally {
  if (gw && gw.exitCode === null) {
    const exited = new Promise((r) => gw!.once("exit", r));
    gw.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
  }
  mock.server.close();
  elMock.server.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`  (could not remove temp dir ${dir})`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
