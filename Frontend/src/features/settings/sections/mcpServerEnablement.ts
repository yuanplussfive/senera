import type { McpServerSettingsItem } from "../../../api/eventTypes";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";

/** Mirrors the backend MCP activation contract inside the optimistic settings draft. */
export function readMcpServerEnabledDraft(draft: Record<string, unknown>, server: McpServerSettingsItem): boolean {
  // Readiness is a hard gate. Retain a previously saved preference in the
  // draft, but never render an unavailable server as active.
  if (!isMcpServerEnablementMutable(server)) return false;
  const servers = isJsonConfigObject(draft.McpServers) ? draft.McpServers : {};
  const candidate = servers[server.id];
  const entry = isJsonConfigObject(candidate) ? candidate : {};
  return typeof entry.Enabled === "boolean" ? entry.Enabled : server.enabled;
}

/** Writes only the server's declared activation intent, preserving unrelated MCP entries. */
export function writeMcpServerEnabledDraft(
  draft: Record<string, unknown>,
  server: McpServerSettingsItem,
  enabled: boolean,
): Record<string, unknown> {
  const servers = isJsonConfigObject(draft.McpServers) ? structuredClone(draft.McpServers) : {};
  servers[server.id] = { Enabled: enabled };
  return { ...draft, McpServers: servers };
}

/** Required inputs and host capabilities are authoritative readiness gates. */
export function isMcpServerEnablementMutable(server: McpServerSettingsItem): boolean {
  return server.status === "configured";
}
