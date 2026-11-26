import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { z } from "zod";
import { config } from "./config.js";

export const ModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "id: lowercase letters, digits, . _ -"),
  path: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "path must be a relative API path like vendor/model/task")
    .refine((p) => !p.includes(".."), "path must not contain .."),
  kind: z.enum(["image", "video", "audio", "other"]),
  label: z.string(),
  notes: z.string().optional(),
  example_input: z.record(z.string(), z.unknown()).optional(),
  max_usd: z.number().positive(),
  disabled: z.boolean().optional(),
});
export type Model = z.infer<typeof ModelSchema>;

const FileSchema = z.object({ _readme: z.string().optional(), models: z.array(ModelSchema) });

let cache: { mtime: number; models: Model[] } | null = null;

export function loadModels(): Model[] {
  if (!existsSync(config.modelsFile)) return [];
  // reload-on-change so admins can edit models.json without a restart
  const mtime = statSync(config.modelsFile).mtimeMs;
  if (cache && cache.mtime === mtime) return cache.models;
  const raw = readFileSync(config.modelsFile, "utf8");
  const parsed = FileSchema.parse(JSON.parse(raw));
  const ids = new Set<string>();
  for (const m of parsed.models) {
    if (ids.has(m.id)) throw new Error(`Duplicate model id in ${config.modelsFile}: ${m.id}`);
    ids.add(m.id);
  }
  cache = { mtime, models: parsed.models };
  return parsed.models;
}

export function activeModels(): Model[] {
  return loadModels().filter((m) => !m.disabled);
}

export function findModel(id: string): Model | undefined {
  return activeModels().find((m) => m.id === id);
}

export function saveModels(models: Model[]): void {
  const existing = existsSync(config.modelsFile) ? JSON.parse(readFileSync(config.modelsFile, "utf8")) : {};
  writeFileSync(config.modelsFile, JSON.stringify({ _readme: existing._readme, models }, null, 2) + "\n");
  cache = null;
}
