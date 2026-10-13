/** Discovery describes capabilities even when their execution prerequisites are absent. */
export type AgentToolAvailability =
  | { readonly status: "ready" }
  | { readonly status: "unverified" }
  | { readonly status: "needs_input"; readonly inputIds: readonly string[] }
  | { readonly status: "unavailable"; readonly reason: string; readonly message?: string };

export const ReadyAgentToolAvailability = { status: "ready" } as const;

export function isAgentToolExecutable(tool: { readonly availability?: AgentToolAvailability }): boolean {
  return tool.availability === undefined || tool.availability.status === "ready";
}
