import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import type { AgentChannelMarkdownResourceReference } from "./AgentChannelOutboundMedia.js";

export function appendAgentChannelMarkdownResourceAlias(
  reference: AgentChannelMarkdownResourceReference,
  alias: string,
): AgentChannelMarkdownResourceReference {
  if (alias === reference.source || reference.aliases?.includes(alias)) return reference;
  return { ...reference, aliases: [...(reference.aliases ?? []), alias] };
}

export function agentChannelMarkdownResourceIdentity(reference: AgentChannelMarkdownResourceReference): string {
  switch (reference.kind) {
    case "senera":
      return stringifyAgentCanonicalJson({ kind: reference.kind, resourceUri: reference.resourceUri });
    case "http":
      return stringifyAgentCanonicalJson({ kind: reference.kind, url: normalizeHttpResourceIdentity(reference.url) });
    case "workspace":
      return stringifyAgentCanonicalJson({
        kind: reference.kind,
        absolutePath: normalizeWorkspaceResourceIdentity(reference.absolutePath),
      });
    case "unresolved":
      return stringifyAgentCanonicalJson({
        kind: reference.kind,
        source: normalizeUnresolvedResourceIdentity(reference.source),
      });
  }
}

function normalizeHttpResourceIdentity(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value.trim();
  }
}

function normalizeWorkspaceResourceIdentity(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/\/+/gu, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeUnresolvedResourceIdentity(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+/gu, "/").toLowerCase();
}
