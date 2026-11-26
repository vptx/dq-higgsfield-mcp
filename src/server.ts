import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { assertServerConfig, config } from "./config.js";
import { getRequest, userByToken, type UserRow } from "./db.js";
import { buildServer } from "./tools.js";
import { startPoller } from "./jobs.js";
import { archivedAbsPath, verifyFileSig, type ArchivedFile } from "./archive.js";
import { log } from "./log.js";
import { activeModels } from "./models.js";
import { adminRouter } from "./admin-web.js";

assertServerConfig();
activeModels(); // fail fast on a broken models.json

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

/* -------- tiny in-memory rate limiter per token (protects against runaway agents) -------- */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimit(key: string, max = 120, windowMs = 60_000): boolean {
  const t = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < t) {
    hits.set(key, { n: 1, reset: t + windowMs });
    return true;
  }
  h.n++;
  return h.n <= max;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
}, 60_000).unref();

/* -------- auth: token in URL path (/mcp/u/<token>) for Claude connectors, or Bearer header -------- */
function authenticate(req: Request): UserRow | undefined {
  const fromPath = typeof req.params.token === "string" ? req.params.token : undefined;
  const header = req.header("authorization");
  const fromHeader = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const token = fromPath ?? fromHeader;
  if (!token) return undefined;
  const user = userByToken(token);
  if (!user || user.disabled) return undefined;
  return user;
}

async function handleMcp(req: Request, res: Response) {
  const user = authenticate(req);
  if (!user) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: invalid or disabled Big Cloud token" }, id: null });
    return;
  }
  if (!rateLimit(user.id)) {
    res.status(429).json({ jsonrpc: "2.0", error: { code: -32002, message: "Too many requests" }, id: null });
    return;
  }
  // Stateless mode: a fresh server + transport per HTTP request. Scales horizontally, no session affinity needed.
  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    log.error("mcp.error", { user: user.name, error: String(e) });
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
}

const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });

app.post("/mcp/u/:token", handleMcp);
app.post("/mcp", handleMcp);
app.get(["/mcp", "/mcp/u/:token"], methodNotAllowed);
app.delete(["/mcp", "/mcp/u/:token"], methodNotAllowed);

/* -------- archived outputs (signed, expiring links) -------- */
app.get("/files/:id/:index", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const index = Number(req.params.index);
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? "");
  if (!Number.isInteger(index) || !verifyFileSig(id, index, exp, sig)) {
    res.status(403).send("Link invalid or expired");
    return;
  }
  const row = getRequest(id);
  const archived: ArchivedFile[] = row?.archived_json ? JSON.parse(row.archived_json) : [];
  const entry = archived.find((a) => a.index === index);
  const abs = entry ? archivedAbsPath(entry.file) : null;
  if (!abs) {
    res.status(404).send("Not found");
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(abs);
});

app.use("/admin", adminRouter);
app.get("/", (_req, res) => res.redirect("/admin/"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, models: activeModels().length });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log.error("http.error", { error: String(err) });
  if (!res.headersSent) res.status(400).json({ error: "Bad request" });
});

const stopPoller = startPoller();
const httpServer = app.listen(config.port, config.host, () => {
  log.info("server.started", { url: `${config.publicBaseUrl}/mcp/u/<token>`, port: config.port, archive: Boolean(config.archiveDir) });
});

function shutdown() {
  log.info("server.stopping");
  stopPoller();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
