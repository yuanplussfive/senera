import { agentUnknownRecordOrEmpty, isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type {
  AgentToolArtifactAsset,
  AgentToolArtifactPayload,
  AgentToolEvidenceCandidate,
} from "../Types/ToolRuntimeTypes.js";
import { extension as mimeExtension } from "mime-types";
import { z } from "zod";

const LegacyArtifactMetadataKeys = ["ai.senera/artifact"] as const;

export interface AgentMcpToolResultProjection {
  readonly result: unknown;
  readonly artifactPayload?: AgentToolArtifactPayload;
}

/**
 * Converts the portable MCP CallToolResult envelope into Senera's two output
 * surfaces: a model-safe projection and durable artifact material. It relies
 * on MCP content types, not on a provider or tool-specific output schema.
 *
 * The original envelope is intentionally kept in rawResponse for the Artifact
 * boundary. The model receives only the projection, structured content, and
 * bounded evidence needed for the next turn.
 */
export function projectAgentMcpToolFeedback(value: unknown): AgentMcpToolResultProjection {
  const envelope = agentUnknownRecordOrEmpty(value);
  const hasStructuredContent = envelope.structuredContent !== undefined;
  const content = projectMcpContent(envelope.content, { captureEvidence: hasStructuredContent });
  const structuredContent = envelope.structuredContent;
  // structuredContent is the MCP tool's opaque, schema-governed value. Do not
  // merge content blocks into it: doing so would invalidate a declared
  // outputSchema and would guess the meaning of plugin-defined fields.
  const result = hasStructuredContent ? structuredContent : projectMcpContentResult(content);
  const legacy = projectLegacyArtifactPayload(envelope);
  const artifactPayload = mergeArtifactPayload(legacy, {
    rawResponse: envelope,
    ...(content.assets.length > 0 ? { assets: content.assets } : {}),
    ...(content.evidence.length > 0 ? { evidence: content.evidence } : {}),
  });

  return {
    result,
    ...(artifactPayload ? { artifactPayload } : {}),
  };
}

export function projectAgentMcpToolResult(value: unknown): unknown {
  return projectAgentMcpToolFeedback(value).result;
}

export function extractAgentMcpText(value: unknown): string {
  const envelope = agentUnknownRecordOrEmpty(value);
  const content = projectMcpContent(envelope.content);
  const contentText = content.text.join("\n");
  if (contentText) return contentText;

  const structured = agentUnknownRecordOrEmpty(envelope.structuredContent);
  if (typeof structured.content === "string") return structured.content;
  return "";
}

export function projectAgentMcpArtifactPayload(value: unknown): AgentToolArtifactPayload | undefined {
  const envelope = agentUnknownRecordOrEmpty(value);
  const content = projectMcpContent(envelope.content, { captureEvidence: envelope.structuredContent !== undefined });
  return mergeArtifactPayload(projectLegacyArtifactPayload(envelope), {
    rawResponse: envelope,
    ...(content.assets.length > 0 ? { assets: content.assets } : {}),
    ...(content.evidence.length > 0 ? { evidence: content.evidence } : {}),
  });
}

interface ProjectedMcpContent {
  readonly text: string[];
  readonly blocks: unknown[];
  readonly assets: AgentToolArtifactAsset[];
  readonly evidence: AgentToolEvidenceCandidate[];
}

function projectMcpContent(value: unknown, options: { captureEvidence?: boolean } = {}): ProjectedMcpContent {
  const projected: ProjectedMcpContent = {
    text: [],
    blocks: [],
    assets: [],
    evidence: [],
  };
  if (!Array.isArray(value)) return projected;

  for (const [index, item] of value.entries()) {
    const record = agentUnknownRecordOrEmpty(item);
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "text" && typeof record.text === "string") {
      const text = record.text.trim();
      if (text) {
        projected.text.push(text);
        projected.blocks.push({ type: "text", text, ...projectAnnotations(record.annotations) });
        if (options.captureEvidence) {
          projected.evidence.push(mcpContentEvidence(index, text, "text"));
        }
      }
      continue;
    }
    if (type === "image" || type === "audio") {
      projectBinaryContent(record, index, type, projected, options);
      continue;
    }
    if (type === "resource") {
      projectResourceContent(record.resource, index, projected, options, record.annotations);
      continue;
    }
    if (type === "resource_link") {
      projectResourceLink(record, projected);
    }
  }
  return projected;
}

function projectBinaryContent(
  record: Record<string, unknown>,
  index: number,
  type: "image" | "audio",
  projected: ProjectedMcpContent,
  options: { captureEvidence?: boolean },
): void {
  const data = typeof record.data === "string" ? record.data : undefined;
  const mediaType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  if (!data || !mediaType || !isBase64(data)) return;

  const id = `mcp-content-${index + 1}`;
  const fileName = `${id}.${mediaTypeExtension(mediaType)}`;
  const placeholder = `senera://artifact-asset/${id}`;
  projected.assets.push({ id, fileName, mediaType, dataBase64: data });
  projected.blocks.push({
    type,
    mimeType: mediaType,
    uri: placeholder,
    ...projectAnnotations(record.annotations),
  });
  if (type === "image") {
    projected.text.push(`![MCP image](${placeholder})`);
  }
  if (options.captureEvidence) {
    projected.evidence.push(mcpContentEvidence(index, `${type} content`, type, id));
  }
}

function projectResourceContent(
  value: unknown,
  index: number,
  projected: ProjectedMcpContent,
  options: { captureEvidence?: boolean },
  annotations: unknown,
): void {
  const resource = agentUnknownRecordOrEmpty(value);
  const uri = typeof resource.uri === "string" ? resource.uri.trim() : "";
  const mimeType = typeof resource.mimeType === "string" ? resource.mimeType.trim() : "";
  if (typeof resource.text === "string") {
    const text = resource.text.trim();
    if (text) {
      projected.text.push(text);
      projected.blocks.push({
        type: "resource",
        uri: uri || undefined,
        mimeType: mimeType || undefined,
        text,
        ...projectAnnotations(annotations),
      });
      if (options.captureEvidence) {
        projected.evidence.push(mcpContentEvidence(index, text, "resource"));
      }
    }
    return;
  }

  if (typeof resource.blob === "string" && isBase64(resource.blob)) {
    const id = `mcp-resource-${index + 1}`;
    const fileName = `${id}.${mediaTypeExtension(mimeType || "application/octet-stream")}`;
    const placeholder = `senera://artifact-asset/${id}`;
    projected.assets.push({
      id,
      fileName,
      mediaType: mimeType || "application/octet-stream",
      dataBase64: resource.blob,
    });
    projected.blocks.push({
      type: "resource",
      uri: placeholder,
      mimeType: mimeType || undefined,
      ...projectAnnotations(annotations),
    });
    if (mimeType.startsWith("image/")) projected.text.push(`![MCP resource](${placeholder})`);
    if (options.captureEvidence) {
      projected.evidence.push(mcpContentEvidence(index, "Embedded resource", "resource", id));
    }
    return;
  }

  if (uri) {
    projected.blocks.push({
      type: "resource",
      uri,
      mimeType: mimeType || undefined,
      ...projectAnnotations(annotations),
    });
    projected.evidence.push(resourceEvidence(uri, uri, "MCP resource"));
  }
}

function projectResourceLink(value: Record<string, unknown>, projected: ProjectedMcpContent): void {
  const uri = typeof value.uri === "string" ? value.uri.trim() : "";
  if (!uri) return;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim() : "";
  projected.blocks.push({
    type: "resource_link",
    uri,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...projectAnnotations(value.annotations),
  });
  projected.evidence.push(resourceEvidence(uri, description || name || uri, name || "MCP resource"));
}

function mcpContentEvidence(
  index: number,
  display: string,
  contentType: string,
  assetId?: string,
): AgentToolEvidenceCandidate {
  return {
    key: `content:${index}`,
    kind: "mcp-content",
    locator: `$.content[${index}]`,
    display,
    label: `MCP ${contentType}`,
    source: "MCP content",
    confidence: 1,
    metadata: {
      automatic: true,
      contentType,
      ...(assetId ? { assetId } : {}),
    },
  };
}

function projectAnnotations(value: unknown): Record<string, unknown> {
  if (!isAgentUnknownRecord(value)) return {};
  const audience = Array.isArray(value.audience)
    ? value.audience.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const priority = typeof value.priority === "number" && Number.isFinite(value.priority) ? value.priority : undefined;
  const lastModified = typeof value.lastModified === "string" ? value.lastModified : undefined;
  if ((!audience || audience.length === 0) && priority === undefined && !lastModified) return {};
  return {
    annotations: {
      ...(audience && audience.length > 0 ? { audience } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(lastModified ? { lastModified } : {}),
    },
  };
}

function resourceEvidence(uri: string, display: string, label: string): AgentToolEvidenceCandidate {
  return {
    key: `resource:${uri}`,
    kind: "resource",
    locator: uri,
    display,
    label,
    source: "MCP content",
    confidence: 1,
    facts: [{ name: "uri", value: uri }],
    metadata: { automatic: true, contentType: "resource" },
  };
}

function projectMcpContentResult(content: ProjectedMcpContent): unknown {
  const text = content.text.join("\n\n").trim();
  if (content.blocks.length === 0) return { text };
  return {
    ...(text ? { text } : {}),
    content: content.blocks,
  };
}

function projectLegacyArtifactPayload(envelope: Record<string, unknown>): AgentToolArtifactPayload | undefined {
  const meta = agentUnknownRecordOrEmpty(envelope._meta);
  for (const key of LegacyArtifactMetadataKeys) {
    const parsed = AgentMcpArtifactPayloadSchema.safeParse(meta[key]);
    if (parsed.success) {
      const payload = parsed.data;
      if (
        payload.rawResponse !== undefined ||
        (payload.assets?.length ?? 0) > 0 ||
        (payload.evidence?.length ?? 0) > 0
      ) {
        return payload;
      }
    }
  }
  return undefined;
}

function mergeArtifactPayload(
  left: AgentToolArtifactPayload | undefined,
  right: AgentToolArtifactPayload,
): AgentToolArtifactPayload | undefined {
  const assets = [...(left?.assets ?? []), ...(right.assets ?? [])];
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
  const evidence = [...(left?.evidence ?? []), ...(right.evidence ?? [])];
  const uniqueEvidence = [
    ...new Map(evidence.map((entry) => [entry.key ?? `${entry.kind}:${entry.locator}`, entry])).values(),
  ];
  const rawResponse = left?.rawResponse ?? right.rawResponse;
  if (rawResponse === undefined && uniqueAssets.length === 0 && uniqueEvidence.length === 0) return undefined;
  return {
    ...(rawResponse === undefined ? {} : { rawResponse }),
    ...(uniqueAssets.length > 0 ? { assets: uniqueAssets } : {}),
    ...(uniqueEvidence.length > 0 ? { evidence: uniqueEvidence } : {}),
  };
}

const AgentMcpArtifactAssetSchema = z
  .object({
    id: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    mediaType: z.string().trim().min(1),
    dataBase64: z.string().trim().min(1).refine(isBase64, "must be base64"),
  })
  .strict();

const AgentMcpEvidenceCandidateSchema = z
  .object({
    key: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1),
    locator: z.string().trim().min(1),
    display: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    confidence: z.number().finite().optional(),
    facts: z.array(z.object({ name: z.string().trim().min(1), value: z.unknown() }).strict()).optional(),
    artifactRefs: z.array(z.string().trim().min(1)).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const AgentMcpArtifactPayloadSchema = z
  .object({
    rawResponse: z.unknown().optional(),
    assets: z.array(AgentMcpArtifactAssetSchema).optional(),
    evidence: z.array(AgentMcpEvidenceCandidateSchema).optional(),
  })
  .strict();

function isBase64(value: string): boolean {
  const normalized = value.replace(/\s+/gu, "");
  return (
    normalized.length > 0 &&
    normalized.length % 4 === 0 &&
    /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/iu.test(normalized)
  );
}

function mediaTypeExtension(mediaType: string): string {
  const known = mimeExtension(mediaType);
  if (known) return known;
  const subtype = mediaType.split("/", 2)[1]?.replace(/[^a-z0-9]+/giu, "");
  return subtype || "bin";
}
