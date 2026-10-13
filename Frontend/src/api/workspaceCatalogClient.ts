import {
  AgentWorkspaceCatalogRoute,
  AgentWorkspaceCatalogSnapshotSchema,
  type AgentWorkspaceCatalogSnapshot,
} from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";
import { buildServerApiUrl } from "./authClient";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export async function readWorkspaceCatalog(
  httpBaseUrl: string,
  signal: AbortSignal,
): Promise<AgentWorkspaceCatalogSnapshot> {
  const response = await fetch(buildServerApiUrl(httpBaseUrl, AgentWorkspaceCatalogRoute), {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw new Error(frontendMessage("workspace.catalogFailed"));
  return AgentWorkspaceCatalogSnapshotSchema.parse(await response.json());
}
