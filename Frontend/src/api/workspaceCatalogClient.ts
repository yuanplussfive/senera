import {
  AgentWorkspaceCatalogRoute,
  AgentWorkspaceCatalogSnapshotSchema,
  type AgentWorkspaceId,
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

export async function forgetWorkspace(
  httpBaseUrl: string,
  workspaceId: AgentWorkspaceId,
  csrfToken: string | undefined,
): Promise<AgentWorkspaceCatalogSnapshot> {
  const url = new URL(buildServerApiUrl(httpBaseUrl, AgentWorkspaceCatalogRoute));
  url.searchParams.set("workspaceId", workspaceId);
  const response = await fetch(url, {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const message =
      error?.code === "workspace_in_use"
        ? frontendMessage("workspace.forgetInUse")
        : typeof error?.message === "string"
          ? error.message
          : frontendMessage("workspace.forgetFailed");
    throw new Error(message);
  }
  return AgentWorkspaceCatalogSnapshotSchema.parse(payload);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
