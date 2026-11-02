import { DefaultAgentTimeZone } from "../../Time/AgentTime.js";
import type { readAgentOneBot11ClientRoute } from "../AgentChannelClientRoutes.js";

/** Shared by server-hosted and APK-hosted documents; protocol identity stays workspace-owned. */
export function agentQqClientDocumentContext(
  route: NonNullable<ReturnType<typeof readAgentOneBot11ClientRoute>>,
  consolePath: string,
): Readonly<Record<string, string>> {
  return {
    "senera-qq-options-key": `stapxs:options:${route.workspaceId}`,
    "senera-workspace-id": route.workspaceId,
    "senera-client-root": route.root,
    "senera-console-path": consolePath,
    "senera-time-zone": DefaultAgentTimeZone,
  };
}

export function installAgentQqClientDocumentContext(
  document: Document,
  route: NonNullable<ReturnType<typeof readAgentOneBot11ClientRoute>>,
): void {
  const consolePath = document.querySelector<HTMLMetaElement>('meta[name="senera-console-path"]')?.content ?? "/";
  for (const [name, content] of Object.entries(agentQqClientDocumentContext(route, consolePath))) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      document.head.append(meta);
    }
    meta.content = content;
  }
  if (!document.querySelector('link[rel="license"]')) {
    const license = document.createElement("link");
    license.rel = "license";
    license.href = `${route.root}source.tar.gz`;
    document.head.append(license);
  }
}
