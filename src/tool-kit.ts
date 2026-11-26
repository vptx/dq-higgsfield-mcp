import { getRequest, type UserRow } from "./db.js";
import { UserFacingError } from "./jobs.js";
import { log } from "./log.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

export const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
export const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

export function wrap<A>(user: UserRow, tool: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof UserFacingError) return fail(e.message);
      log.error("tool.error", { tool, user: user.name, error: String(e) });
      return fail("Internal error in the Big Cloud AI gateway. The admin can see details in the server log.");
    }
  };
}

export function ownRequest(user: UserRow, id: string) {
  const r = getRequest(id);
  if (!r || (r.user_id !== user.id && user.role !== "admin")) throw new UserFacingError("No such generation in your history.");
  return r;
}
