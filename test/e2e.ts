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

const MOCK_PORT = 9911;
const GW_PORT = 9912;
const dir = mkdtempSync(join(tmpdir(), "dqhf-"));
const env = {
  ...process.env,
  HF_CREDENTIALS: MOCK_CREDS,
  HF_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
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

const tsx = join(process.cwd(), "node_modules/.bin/tsx");
function admin(...args: string[]): string {
  return execFileSync(tsx, ["src/admin.ts", ...args], { env, encoding: "utf8" });
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

try {
  const tAdmin = addUser("yazan", "--admin", "--budget", "100");
  const tSara = addUser("sara", "--budget", "1", "--concurrency", "1");
  const tOmar = addUser("omar", "--budget", "10");

  gw = spawn(tsx, ["src/server.ts"], { env, stdio: ["ignore", "inherit", "inherit"] });
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
  check("member sees 7 tools, no admin tool", saraTools.length === 7 && !saraTools.includes("hf_admin_team_usage"), saraTools);
  check("admin also sees hf_admin_team_usage", adminTools.includes("hf_admin_team_usage"));

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
  const before = (await call(omar, "hf_my_budget")).structuredContent.budget.used_usd;
  const ns = await call(omar, "hf_generate", { model: "flux-kontext-max-t2i", input: { prompt: "nsfw thing" } });
  check("nsfw status surfaced", ns.structuredContent?.job?.status === "nsfw", ns);
  const after = (await call(omar, "hf_my_budget")).structuredContent.budget.used_usd;
  check("nsfw not charged to budget", before === after, { before, after });

  const badInput = await call(omar, "hf_generate", { model: "flux-kontext-max-t2i", input: { aspect_ratio: "1:1" } });
  check("422 from Higgsfield surfaced as readable error", badInput.isError && badInput.content[0].text.includes("rejected the input"), badInput);
  const afterBad = (await call(omar, "hf_my_budget")).structuredContent.budget;
  check("rejected submission releases reservation", afterBad.reserved_usd === 0 && afterBad.used_usd === after, afterBad);

  console.log("\nIsolation");
  const peek = await call(omar, "hf_get_status", { id: job1.id });
  check("member cannot read another member's generation", peek.isError, peek);
  const adminPeek = await call(admin_, "hf_get_status", { id: job1.id });
  check("admin can read any generation", adminPeek.structuredContent?.job?.id === job1.id);
  const hist = await call(sara, "hf_my_history", { project: "test" });
  check("history filtered by project", hist.structuredContent?.jobs?.length === 1, hist);

  console.log("\nConcurrency + cancel");
  await call(admin_, "hf_my_budget");
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
  const usage = await call(admin_, "hf_admin_team_usage");
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
  const bgHist = await call(omar2, "hf_my_history", { limit: 1 });
  check("poller finalizes jobs nobody is waiting on", bgHist.structuredContent?.jobs?.[0]?.id === bg.structuredContent?.job?.id && bgHist.structuredContent?.jobs?.[0]?.status === "completed", bgHist);

  for (const c of [admin_, sara, omar, omar2]) await c.close().catch(() => {});
} catch (e) {
  failed++;
  console.error("Test crashed:", e);
} finally {
  gw?.kill("SIGTERM");
  mock.server.close();
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
