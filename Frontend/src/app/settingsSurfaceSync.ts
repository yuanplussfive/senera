import type { WsRequest } from "../api/eventTypes";

export function buildSettingsSurfaceSyncRequests(): WsRequest[] {
  return [{ type: "config.get" }, { type: "model.list" }, { type: "systemTool.list" }, { type: "mcpServer.list" }];
}
