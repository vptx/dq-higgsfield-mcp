import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listUserRequests, usageReport, type UserRow } from "./db.js";
import { budgetView, toView } from "./jobs.js";
import { SERVICES, usableServices, type ServiceId } from "./services.js";
import { ok, wrap } from "./tool-kit.js";
import { higgsfieldInstructions, registerHiggsfield } from "./tools/higgsfield.js";
import { elevenlabsInstructions, registerElevenLabs } from "./tools/elevenlabs.js";

const PROVIDERS: Record<ServiceId, { register: (s: McpServer, u: UserRow) => void; instructions: string }> = {
  higgsfield: { register: registerHiggsfield, instructions: higgsfieldInstructions },
  elevenlabs: { register: registerElevenLabs, instructions: elevenlabsInstructions },
};

export function buildServer(user: UserRow): McpServer {
  const services = usableServices(user.services);
  const labels = services.map((id) => SERVICES.find((s) => s.id === id)!.label);
  const server = new McpServer(
    { name: "big-cloud-ai", version: "2.0.0" },
    {
      instructions:
        `Big Cloud's internal AI gateway. You are acting for team member "${user.name}". ` +
        (services.length ? `Services enabled for this member: ${labels.join(", ")}. ` : "No services are enabled for this member yet; tell them to ask an admin. ") +
        "Every generation spends real money from this person's single monthly budget, shared across all services. " +
        "Never retry a paid generation with the same input unless the user asks — it charges again. " +
        services.map((s) => PROVIDERS[s].instructions).join(" "),
    },
  );

  for (const s of services) PROVIDERS[s].register(server, user);

  server.registerTool(
    "my_history",
    {
      title: "My recent generations",
      description: "Lists your most recent generations across all services (newest first), optionally filtered by project.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional(), project: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(user, "my_history", async ({ limit, project }: { limit?: number; project?: string }) =>
      ok({ jobs: listUserRequests(user.id, limit ?? 10, project).map(toView) }),
    ),
  );

  server.registerTool(
    "my_budget",
    {
      title: "My budget",
      description: "Shows your monthly budget (shared across all services), what you've used, what's left, and which services you can use.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(user, "my_budget", async () =>
      ok({ user: user.name, role: user.role, services: labels, max_concurrent: user.max_concurrent, budget: budgetView(user) }),
    ),
  );

  if (user.role === "admin") {
    server.registerTool(
      "admin_team_usage",
      {
        title: "Team usage (admin)",
        description: "Admin only: this month's spend per team member, across all services.",
        inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default current month") },
        annotations: { readOnlyHint: true },
      },
      wrap(user, "admin_team_usage", async ({ month }: { month?: string }) => {
        const at = month ? new Date(`${month}-15T00:00:00Z`) : new Date();
        const rows = usageReport(at);
        const total = rows.reduce((s, r) => s + r.committed + r.reserved, 0);
        return ok({ month: at.toISOString().slice(0, 7), total_usd: Number(total.toFixed(4)), members: rows });
      }),
    );
  }

  return server;
}
