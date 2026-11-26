import { config } from "./config.js";

export const SERVICE_IDS = ["higgsfield", "elevenlabs"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export interface ServiceInfo {
  id: ServiceId;
  label: string;
  description: string;
  configured: () => boolean;
}

export const SERVICES: ServiceInfo[] = [
  { id: "higgsfield", label: "Higgsfield", description: "صور وفيديو", configured: () => Boolean(config.hfCredentials) },
  { id: "elevenlabs", label: "ElevenLabs", description: "تحويل نص لصوت ومؤثرات صوتية", configured: () => Boolean(config.elevenlabsApiKey) },
];

export const isServiceId = (v: unknown): v is ServiceId => typeof v === "string" && (SERVICE_IDS as readonly string[]).includes(v);

export const configuredServiceIds = (): ServiceId[] => SERVICES.filter((s) => s.configured()).map((s) => s.id);

/** Parses the users.services column (JSON array), dropping anything unknown. */
export function parseServices(raw: string | null | undefined): ServiceId[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter(isServiceId))] : [];
  } catch {
    return [];
  }
}

/** Services a member may actually use right now: granted to them and configured on the server. */
export const usableServices = (raw: string): ServiceId[] => {
  const on = new Set(configuredServiceIds());
  return parseServices(raw).filter((s) => on.has(s));
};
