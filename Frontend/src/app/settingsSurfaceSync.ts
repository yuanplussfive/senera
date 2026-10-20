import type { WsRequest } from "../api/eventTypes";
import type { SettingsSectionId } from "../features/settings/settingsSectionContract";

const SettingsBootstrapRequests = [
  { type: "config.get" },
  { type: "workspace.get" },
] as const satisfies readonly WsRequest[];

const SettingsSectionRequests = {
  "model-service": [{ type: "model.list" }, { type: "systemTool.list" }],
  "model-roles": [{ type: "model.list" }, { type: "systemTool.list" }],
  runtime: [],
  prompt: [],
  planning: [],
  retrieval: [],
  "system-tools": [{ type: "systemTool.list" }, { type: "mcpServer.list" }],
  dependencies: [{ type: "runtimeDependency.list" }],
  "mcp-servers": [{ type: "systemTool.list" }, { type: "mcpServer.list" }],
  channels: [{ type: "systemTool.list" }],
  general: [],
  appearance: [],
  storage: [],
  workspace: [],
  about: [],
} as const satisfies Record<SettingsSectionId, readonly WsRequest[]>;

/** Requests needed to render one settings surface, with costly catalogs deferred to their owners. */
export function buildSettingsSurfaceSyncRequests(section: SettingsSectionId): readonly WsRequest[] {
  return [...SettingsBootstrapRequests, ...SettingsSectionRequests[section]];
}
