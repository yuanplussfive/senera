import { AgentResourceUriError } from "./AgentResourceUriError.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { AgentResourceUriContract } from "./AgentResourceContract.js";

const ResourceIdPattern = new RegExp(`^${AgentResourceUriContract.ResourceIdPattern}$`, "u");

export interface AgentResourceReference {
  readonly resourceId: string;
  readonly uri: string;
}

export function createAgentResourceUri(resourceId: string): string {
  const normalizedId = normalizeResourceId(resourceId);
  if (!normalizedId) {
    throw new AgentResourceUriError(resourceId, "invalid_resource_id");
  }

  return new URL(
    `${encodeURIComponent(normalizedId)}`,
    `${AgentResourceUriContract.Protocol}//${AgentResourceUriContract.Authority}/`,
  ).toString();
}

export function createAgentResourceId(value: string): string {
  const normalized = value.trim();
  if (ResourceIdPattern.test(normalized)) return normalized;
  return `res_${sha256Hex(normalized).slice(0, 32)}`;
}

export function normalizeAgentResourceUri(value: string): string | undefined {
  const reference = parseAgentResourceReference(value);
  return reference?.uri;
}

export function parseAgentResourceId(value: string): string | undefined {
  return parseAgentResourceReference(value)?.resourceId;
}

export function parseAgentResourceReference(value: string): AgentResourceReference | undefined {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }

  if (
    uri.protocol !== AgentResourceUriContract.Protocol ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash
  ) {
    return undefined;
  }

  const resourceId = readResourceId(uri.pathname);
  if (!resourceId) return undefined;

  if (uri.hostname !== AgentResourceUriContract.Authority) return undefined;

  return {
    resourceId,
    uri: createAgentResourceUri(resourceId),
  };
}

export function normalizeResourceId(value: string): string | undefined {
  const normalized = value.trim();
  return ResourceIdPattern.test(normalized) ? normalized : undefined;
}

function readResourceId(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return undefined;

  let resourceId: string;
  try {
    resourceId = decodeURIComponent(segments[0] ?? "");
  } catch {
    return undefined;
  }
  return normalizeResourceId(resourceId);
}
