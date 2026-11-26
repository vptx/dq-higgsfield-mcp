#!/usr/bin/env node
import { config } from "./config.js";
import { createUser, listUsers, rotateToken, updateUser, usageReport, userByName, userMonthSpend } from "./db.js";
import { loadModels, saveModels, ModelSchema } from "./models.js";
import { isServiceId, parseServices, SERVICE_IDS, type ServiceId } from "./services.js";

const [, , cmd, ...rest] = process.argv;

function flags(args: string[]) {
  const pos: string[] = [];
  const f: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        f[key] = next;
        i++;
      } else f[key] = true;
    } else pos.push(a);
  }
  return { pos, f };
}

const die = (msg: string): never => {
  console.error("✖ " + msg);
  process.exit(1);
};
const needUser = (name?: string) => (name ? userByName(name) : undefined) ?? die(`No such user: ${name ?? "(missing)"}`);
const connectorUrl = (token: string) => `${config.publicBaseUrl}/mcp/u/${token}`;
const money = (n: number) => "$" + n.toFixed(2);

function printToken(name: string, token: string) {
  console.log(`\n  User:           ${name}`);
  console.log(`  Connector URL:  ${connectorUrl(token)}`);
  console.log(`  Bearer token:   ${token}`);
  console.log("\n  ⚠ Shown once. Send it to the user privately (not in a group chat). It is stored only as a hash.\n");
}

function servicesArg(raw: string): ServiceId[] {
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((s) => !isServiceId(s));
  if (bad.length) die(`Unknown service(s): ${bad.join(", ")}. Known: ${SERVICE_IDS.join(", ")}`);
  return [...new Set(list)] as ServiceId[];
}

const { pos, f } = flags(rest);

switch (cmd) {
  case "user:add": {
    const name = pos[0] ?? die("Usage: user:add <name> [--budget 50] [--concurrency 3] [--admin] [--services higgsfield,elevenlabs]");
    if (userByName(name)) die(`User "${name}" already exists`);
    const { token } = createUser({
      name,
      role: f.admin ? "admin" : "member",
      monthlyBudgetUsd: f.budget ? Number(f.budget) : undefined,
      maxConcurrent: f.concurrency ? Number(f.concurrency) : undefined,
      services: typeof f.services === "string" ? servicesArg(f.services) : undefined,
    });
    printToken(name, token);
    break;
  }
  case "user:list": {
    const rows = listUsers().map((u) => {
      const s = userMonthSpend(u.id);
      return {
        name: u.name,
        role: u.role,
        status: u.disabled ? "disabled" : "active",
        services: parseServices(u.services).join(","),
        budget: money(u.monthly_budget_usd),
        used: money(s.committed),
        reserved: money(s.reserved),
        concurrency: u.max_concurrent,
      };
    });
    console.table(rows);
    break;
  }
  case "user:budget": {
    const u = needUser(pos[0]);
    const n = Number(pos[1]);
    if (!Number.isFinite(n) || n < 0) die("Usage: user:budget <name> <usd>");
    updateUser(u.id, { monthly_budget_usd: n });
    console.log(`✔ ${u.name}: monthly budget → ${money(n)}`);
    break;
  }
  case "user:concurrency": {
    const u = needUser(pos[0]);
    const n = Number(pos[1]);
    if (!Number.isInteger(n) || n < 1) die("Usage: user:concurrency <name> <n>");
    updateUser(u.id, { max_concurrent: n });
    console.log(`✔ ${u.name}: max concurrent → ${n}`);
    break;
  }
  case "user:services": {
    const u = needUser(pos[0]);
    const list = servicesArg(pos[1] ?? "");
    updateUser(u.id, { services: JSON.stringify(list) });
    console.log(`✔ ${u.name}: services → ${list.join(", ") || "(none)"}`);
    break;
  }
  case "user:role": {
    const u = needUser(pos[0]);
    const role = pos[1];
    if (role !== "admin" && role !== "member") die("Usage: user:role <name> admin|member");
    updateUser(u.id, { role: role as "admin" | "member" });
    console.log(`✔ ${u.name}: role → ${role}`);
    break;
  }
  case "user:disable":
  case "user:enable": {
    const u = needUser(pos[0]);
    updateUser(u.id, { disabled: cmd === "user:disable" ? 1 : 0 });
    console.log(`✔ ${u.name}: ${cmd === "user:disable" ? "disabled (connector stops working immediately)" : "enabled"}`);
    break;
  }
  case "user:rotate": {
    const u = needUser(pos[0]);
    printToken(u.name, rotateToken(u.id));
    console.log("  The old connector URL stopped working. The user must remove and re-add the connector in Claude.\n");
    break;
  }
  case "usage": {
    const month = typeof f.month === "string" ? f.month : undefined;
    if (month && !/^\d{4}-\d{2}$/.test(month)) die("--month must be YYYY-MM");
    const at = month ? new Date(`${month}-15T00:00:00Z`) : new Date();
    const rows = usageReport(at);
    console.log(`\nUsage for ${at.toISOString().slice(0, 7)} (USD, based on Higgsfield estimates)`);
    console.table(
      rows.map((r) => ({
        name: r.name,
        budget: money(r.monthly_budget_usd),
        used: money(r.committed),
        running: money(r.reserved),
        left: money(Math.max(0, r.monthly_budget_usd - r.committed - r.reserved)),
        done: r.completed,
        failed: r.failed,
      })),
    );
    console.log(`Team total: ${money(rows.reduce((s, r) => s + r.committed + r.reserved, 0))}\n`);
    break;
  }
  case "models:list": {
    console.table(loadModels().map((m) => ({ id: m.id, kind: m.kind, path: m.path, max_usd: m.max_usd, disabled: Boolean(m.disabled) })));
    break;
  }
  case "models:add": {
    const parsed = ModelSchema.safeParse({
      id: f.id,
      path: f.path,
      kind: f.kind ?? "video",
      label: f.label ?? f.id,
      notes: typeof f.notes === "string" ? f.notes : undefined,
      example_input: typeof f.example === "string" ? JSON.parse(f.example) : undefined,
      max_usd: Number(f["max-usd"] ?? 1),
    });
    if (!parsed.success) die("Usage: models:add --id kling-3-i2v --path <api/path/from/console> --kind video --label \"Kling 3.0 i2v\" --max-usd 2 [--example '{\"prompt\":\"...\"}']\n" + parsed.error.message);
    const models = loadModels();
    if (models.some((m) => m.id === parsed.data!.id)) die(`Model id exists: ${parsed.data!.id}`);
    saveModels([...models, parsed.data!]);
    console.log(`✔ Added ${parsed.data!.id} → ${parsed.data!.path}`);
    break;
  }
  case "models:disable":
  case "models:enable": {
    const models = loadModels();
    const m = models.find((x) => x.id === pos[0]) ?? die(`No such model: ${pos[0]}`);
    m.disabled = cmd === "models:disable";
    saveModels(models);
    console.log(`✔ ${m.id}: ${m.disabled ? "disabled" : "enabled"}`);
    break;
  }
  default:
    console.log(`Big Cloud · AI gateway admin

  user:add <name> [--budget 50] [--concurrency 3] [--admin] [--services higgsfield,elevenlabs]
                                                              create a member, prints their connector URL
  user:services <name> higgsfield,elevenlabs                  set which services the member can use
  user:list                                                   members, budgets, this month's spend
  user:budget <name> <usd>                                    set monthly budget
  user:concurrency <name> <n>                                 max parallel generations for that member
  user:role <name> admin|member
  user:disable <name> | user:enable <name>
  user:rotate <name>                                          new token, old URL stops working
  usage [--month YYYY-MM]                                     spend report
  models:list
  models:add --id <id> --path <api path> --kind image|video|audio --label <text> --max-usd <n> [--example '<json>']
  models:disable <id> | models:enable <id>
`);
}
