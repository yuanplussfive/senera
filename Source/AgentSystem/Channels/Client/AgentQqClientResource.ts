import path from "node:path";
import { AgentClientExtensionStore } from "./AgentClientExtensionStore.js";
import { AgentQqClientBuild } from "./AgentQqClientBuildContract.js";

export function resolveAgentQqClientResource(store: AgentClientExtensionStore, selectedRelease?: string) {
  const manifest = store.release(AgentQqClientBuild.id, selectedRelease);
  if (!manifest) throw new AgentQqClientReleaseNotFoundError();
  const webRoot = store.publicRoot(manifest);
  return { release: manifest.revision, entryFile: path.join(webRoot, manifest.entry), webRoot, manifest };
}

export type AgentQqClientResource = ReturnType<typeof resolveAgentQqClientResource>;

export class AgentQqClientReleaseNotFoundError extends Error {
  constructor() {
    super(
      "Senera QQ is not installed, or the requested version is unavailable. Install it in Settings → Channels → Senera QQ.",
    );
    this.name = "AgentQqClientReleaseNotFoundError";
  }
}
