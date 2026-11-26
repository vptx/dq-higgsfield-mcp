import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import type { UserRow } from "../db.js";
import { activeModels } from "../models.js";
import { budgetView, cancelJob, estimateCost, generate, refresh, resolveModel, toView, UserFacingError } from "../jobs.js";
import { ok, ownRequest, wrap } from "../tool-kit.js";

export const higgsfieldInstructions =
  "Higgsfield (images/video): pick a model from hf_list_models, start from its example_input, and keep video duration/resolution modest unless asked. " +
  "Use hf_estimate_cost when the user asks about price. hf_generate waits a while, then returns an id you can pass to hf_get_status. " +
  "Higgsfield deletes outputs after ~7 days; archived_links are the long-lived copies.";

const inputSchema = z
  .record(z.string(), z.unknown())
  .describe('Model input exactly as the Higgsfield API expects it, e.g. {"prompt": "...", "duration": 5, "aspect_ratio": "9:16"}. See example_input in hf_list_models.');

export function registerHiggsfield(server: McpServer, user: UserRow): void {
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
      title: "Estimate Higgsfield generation cost",
      description: "Asks Higgsfield what a generation would cost in USD, without generating anything.",
      inputSchema: { model: z.string().describe("Model id from hf_list_models"), input: inputSchema },
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
        const { job, cost_source } = await generate(user, { model: m, input: a.input, project: a.project, waitSeconds: a.wait_seconds ?? config.maxWaitSeconds });
        return ok({ job, cost_basis: cost_source === "higgsfield" ? "Higgsfield estimate" : "model ceiling (no estimate available)", budget: budgetView(user) });
      },
    ),
  );

  server.registerTool(
    "hf_get_status",
    {
      title: "Check a Higgsfield generation",
      description: "Returns the current status and output links of one of your Higgsfield generations.",
      inputSchema: { id: z.string().describe("The id (or Higgsfield request_id) returned by hf_generate") },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "hf_get_status", async ({ id }: { id: string }) => {
      const row = ownRequest(user, id);
      if (row.service !== "higgsfield") throw new UserFacingError("That id is not a Higgsfield generation. Use my_history to see it.");
      return ok({ job: toView(await refresh(row)) });
    }),
  );

  server.registerTool(
    "hf_cancel",
    {
      title: "Cancel a queued Higgsfield generation",
      description: "Cancels one of your generations if it has not started processing yet. Canceled generations are refunded.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    wrap(user, "hf_cancel", async ({ id }: { id: string }) => {
      const row = ownRequest(user, id);
      if (row.service !== "higgsfield") throw new UserFacingError("Only Higgsfield generations can be canceled.");
      return ok({ job: await cancelJob(user, await refresh(row)), budget: budgetView(user) });
    }),
  );
}
