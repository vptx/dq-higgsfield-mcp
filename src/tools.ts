import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { getRequest, listUserRequests, usageReport, type UserRow } from "./db.js";
import { activeModels } from "./models.js";
import { budgetView, cancelJob, estimateCost, generate, refresh, resolveModel, toView, UserFacingError } from "./jobs.js";
import { log } from "./log.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

function wrap<A>(user: UserRow, tool: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof UserFacingError) return fail(e.message);
      log.error("tool.error", { tool, user: user.name, error: String(e) });
      return fail("Internal error in the Big Cloud Higgsfield gateway. The admin can see details in the server log.");
    }
  };
}

const inputSchema = z
  .record(z.string(), z.unknown())
  .describe("Model input exactly as the Higgsfield API expects it, e.g. {\"prompt\": \"...\", \"duration\": 5, \"aspect_ratio\": \"9:16\"}. See example_input in hf_list_models.");

function ownRequest(user: UserRow, id: string) {
  const r = getRequest(id);
  if (!r || (r.user_id !== user.id && user.role !== "admin")) throw new UserFacingError("No such generation in your history.");
  return r;
}

export function buildServer(user: UserRow): McpServer {
  const server = new McpServer(
    { name: "big-cloud-higgsfield", version: "1.0.0" },
    {
      instructions:
        `Big Cloud's internal Higgsfield gateway. You are acting for team member "${user.name}". ` +
        "Every generation spends real money from this person's monthly budget. Before generating: pick a model from hf_list_models, " +
        "start from its example_input, and for video keep duration/resolution modest unless asked. Use hf_estimate_cost when the user asks about price. " +
        "Generations are async: hf_generate waits a while, then returns an id you can pass to hf_get_status. Never retry a generation by calling hf_generate again with the same input unless the user asks — it charges again. " +
        "Higgsfield deletes outputs after ~7 days; archived_links are the long-lived copies.",
    },
  );

  server.registerTool(
    "hf_list_models",
    {
      title: "List approved Higgsfield models",
      description: "Lists the Higgsfield API models the team is allowed to use, with example inputs and per-generation cost ceilings.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_list_models", async () =>
      ok({
        models: activeModels().map((m) => ({ id: m.id, kind: m.kind, label: m.label, notes: m.notes, example_input: m.example_input, max_usd: m.max_usd })),
        custom_paths_allowed: user.role === "admin" && config.allowCustomModelsForAdmins,
      }),
    ),
  );

  server.registerTool(
    "hf_estimate_cost",
    {
      title: "Estimate generation cost",
      description: "Asks Higgsfield what a generation would cost in USD, without generating anything.",
      inputSchema: {
        model: z.string().describe("Model id from hf_list_models"),
        input: inputSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_estimate_cost", async ({ model, input }: { model: string; input: Record<string, unknown> }) => {
      const m = resolveModel(user, model);
      const est = await estimateCost(m, input);
      return ok({
        model: m.id,
        estimated_usd: est.usd,
        source: est.source === "higgsfield" ? "Higgsfield estimate" : "No estimate available — this is the model's ceiling (worst case)",
        budget: budgetView(user),
      });
    }),
  );

  server.registerTool(
    "hf_generate",
    {
      title: "Generate image / video with Higgsfield",
      description:
        "Starts a paid Higgsfield generation charged to your monthly budget. Waits up to wait_seconds for the result, then returns either the output URLs or an id to check with hf_get_status.",
      inputSchema: {
        model: z.string().describe("Model id from hf_list_models"),
        input: inputSchema,
        project: z.string().max(80).optional().describe("Optional client/project tag for reporting, e.g. 'big-cloud-reels'"),
        wait_seconds: z.number().int().min(0).max(120).optional().describe(`How long to wait for completion (capped at ${config.maxWaitSeconds}s). Default: ${config.maxWaitSeconds}.`),
        custom_model_path: z.string().optional().describe("Admins only: call an API path that is not in the approved list."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    wrap(
      user,
      "hf_generate",
      async (a: { model: string; input: Record<string, unknown>; project?: string; wait_seconds?: number; custom_model_path?: string }) => {
        const m = resolveModel(user, a.model, a.custom_model_path);
        const { job, cost_source } = await generate(user, {
          model: m,
          input: a.input,
          project: a.project,
          waitSeconds: a.wait_seconds ?? config.maxWaitSeconds,
        });
        return ok({ job, cost_basis: cost_source === "higgsfield" ? "Higgsfield estimate" : "model ceiling (no estimate available)", budget: budgetView(user) });
      },
    ),
  );

  server.registerTool(
    "hf_get_status",
    {
      title: "Check a generation",
      description: "Returns the current status and output links of one of your generations.",
      inputSchema: { id: z.string().describe("The id (or Higgsfield request_id) returned by hf_generate") },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_get_status", async ({ id }: { id: string }) => {
      const r = await refresh(ownRequest(user, id));
      return ok({ job: toView(r) });
    }),
  );

  server.registerTool(
    "hf_cancel",
    {
      title: "Cancel a queued generation",
      description: "Cancels one of your generations if it has not started processing yet. Canceled generations are refunded.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    wrap(user, "hf_cancel", async ({ id }: { id: string }) => {
      const r = await refresh(ownRequest(user, id));
      return ok({ job: await cancelJob(user, r), budget: budgetView(user) });
    }),
  );

  server.registerTool(
    "hf_my_history",
    {
      title: "My recent generations",
      description: "Lists your most recent generations (newest first), optionally filtered by project.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        project: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_my_history", async ({ limit, project }: { limit?: number; project?: string }) =>
      ok({ jobs: listUserRequests(user.id, limit ?? 10, project).map(toView) }),
    ),
  );

  server.registerTool(
    "hf_my_budget",
    {
      title: "My budget",
      description: "Shows your monthly Higgsfield budget, what you've used, and what's left.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_my_budget", async () => ok({ user: user.name, role: user.role, max_concurrent: user.max_concurrent, budget: budgetView(user) })),
  );

  if (user.role === "admin") {
    server.registerTool(
      "hf_admin_team_usage",
      {
        title: "Team usage (admin)",
        description: "Admin only: this month's spend per team member.",
        inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default current month") },
        annotations: { readOnlyHint: true },
      },
      wrap(user, "hf_admin_team_usage", async ({ month }: { month?: string }) => {
        const at = month ? new Date(`${month}-15T00:00:00Z`) : new Date();
        const rows = usageReport(at);
        const total = rows.reduce((s, r) => s + r.committed + r.reserved, 0);
        return ok({ month: at.toISOString().slice(0, 7), total_usd: Number(total.toFixed(4)), members: rows });
      }),
    );
  }

  return server;
}
