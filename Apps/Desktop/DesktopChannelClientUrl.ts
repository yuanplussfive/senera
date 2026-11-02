import { agentOneBot11ClientPath } from "../../Source/AgentSystem/Channels/AgentChannelClientRoutes.js";
import type { DesktopFrontendSource } from "./DesktopFrontendSource.js";

/** Development uses Vite's same-origin gateway proxy; packaged clients use the local server. */
export function resolveDesktopChannelClientUrl(
  source: DesktopFrontendSource,
  websocketUrl: string,
  workspaceId: string,
): string {
  const origin = new URL(source.kind === "url" ? source.url : websocketUrl);
  if (origin.protocol === "ws:") origin.protocol = "http:";
  else if (origin.protocol === "wss:") origin.protocol = "https:";
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("Channel clients require an HTTP origin.");
  }
  return new URL(agentOneBot11ClientPath(workspaceId), origin).href;
}
