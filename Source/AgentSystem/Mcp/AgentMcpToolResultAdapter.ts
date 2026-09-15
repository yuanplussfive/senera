import { agentUnknownRecordOrEmpty, isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentToolArtifactPayload, AgentToolEvidenceCandidate } from "../Types/ToolRuntimeTypes.js";
import { extension as mimeExtension } from "mime-types";
import type { AgentPublishedResource, AgentResourcePublisher } from "../Resources/AgentResourcePublisher.js";
import { createAgentUploadId } from "../Uploads/AgentUploadLocator.js";
import { projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";

export interface AgentMcpToolResultProjection {
  readonly result: unknown;
  readonly artifactPayload?: AgentToolArtifactPayload;
}

interface AgentMcpToolFeedbackOptions {
  readonly rawResponse?: unknown;
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
function projectAgentMcpToolFeedback(
  value: unknown,
  options: AgentMcpToolFeedbackOptions = {},
): AgentMcpToolResultProjection {
  const envelope = agentUnknownRecordOrEmpty(value);
  const hasStructuredContent = envelope.structuredContent !== undefined;
  const content = projectMcpContent(envelope.content, { captureEvidence: hasStructuredContent });
  const structuredContent = envelope.structuredContent;
  // structuredContent is the MCP tool's opaque, schema-governed value. Do not
  // merge content blocks into it: doing so would invalidate a declared
  // outputSchema and would guess the meaning of plugin-defined fields.
  const result = hasStructuredContent ? structuredContent : projectMcpContentResult(content);
  const artifactPayload: AgentToolArtifactPayload = {
    rawResponse: options.rawResponse ?? envelope,
    ...(content.evidence.length > 0 ? { evidence: content.evidence } : {}),
  };

  return {
    result,
    ...(artifactPayload ? { artifactPayload } : {}),
  };
}

/**
 * Publishes MCP binary content before it reaches the model. MCP image/audio
 * blocks otherwise have no durable identity, so the generic projection would
 * have to invent a temporary URI that the frontend and channels cannot resolve.
 */
export async function projectAgentMcpToolFeedbackWithResources(
  value: unknown,
  publisher: AgentResourcePublisher,
): Promise<AgentMcpToolResultProjection> {
  const envelope = agentUnknownRecordOrEmpty(value);
  const content = Array.isArray(envelope.content) ? envelope.content : [];
  const publishedByContent = new Map<string, AgentPublishedResource>();
  const publishedByIndex = new Map<number, AgentPublishedResource>();
  const canonicalContent: unknown[] = [];
  for (const [index, item] of content.entries()) {
    const record = agentUnknownRecordOrEmpty(item);
    const published = await publishMcpBinaryContent(record, publisher, publishedByContent);
    if (!published) {
      canonicalContent.push(item);
      continue;
    }
    publishedByIndex.set(index, published);
    canonicalContent.push(canonicalMcpResourceBlock(record, published));
  }
  const projected = projectAgentMcpToolFeedback(
    { ...envelope, content: canonicalContent },
    { rawResponse: sanitizeMcpEnvelope(value, publishedByIndex) },
  );
  return projected;
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

interface ProjectedMcpContent {
  readonly text: string[];
  readonly blocks: unknown[];
  readonly evidence: AgentToolEvidenceCandidate[];
}

function projectMcpContent(value: unknown, options: { captureEvidence?: boolean } = {}): ProjectedMcpContent {
  const projected: ProjectedMcpContent = {
    text: [],
    blocks: [],
    evidence: [],
  };
  if (!Array.isArray(value)) return projected;

  for (const [index, item] of value.entries()) {
    const record = agentUnknownRecordOrEmpty(item);
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "text" && typeof record.text === "string") {
      const text = projectAgentModelText(record.text).text.trim();
      if (text) {
        projected.text.push(text);
        projected.blocks.push({ type: "text", text, ...projectAnnotations(record.annotations) });
        if (options.captureEvidence) {
          projected.evidence.push(mcpContentEvidence(index, text, "text"));
        }
      }
      continue;
    }
    if (type === "image" || type === "audio") continue;
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
    const text = projectAgentModelText(resource.text).text.trim();
    if (text) {
      const name = typeof resource.name === "string" ? resource.name.trim() : "";
      projected.text.push(text);
      projected.blocks.push({
        type: "resource",
        uri: uri || undefined,
        mimeType: mimeType || undefined,
        ...(name ? { name } : {}),
        text,
        ...projectAnnotations(annotations),
      });
      if (options.captureEvidence) {
        projected.evidence.push(mcpContentEvidence(index, text, "resource"));
      }
    }
    return;
  }

  if (uri) {
    const name = typeof resource.name === "string" ? resource.name.trim() : "";
    projected.blocks.push({
      type: "resource",
      uri,
      mimeType: mimeType || undefined,
      ...(name ? { name } : {}),
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

async function publishMcpBinaryContent(
  record: Record<string, unknown>,
  publisher: AgentResourcePublisher,
  publishedByContent: Map<string, AgentPublishedResource>,
): Promise<AgentPublishedResource | undefined> {
  const type = typeof record.type === "string" ? record.type : "";
  const data =
    type === "resource"
      ? readResourceBlob(record.resource)
      : type === "image" || type === "audio"
        ? readBinaryContent(record)
        : undefined;
  if (!data) return undefined;

  const key = `${data.mimeType}\u0000${data.data}`;
  const existing = publishedByContent.get(key);
  if (existing) return existing;

  const published = await publisher.publishBytes({
    bytes: Buffer.from(data.data, "base64"),
    name: resourceFileName(data.mimeType),
    mime: data.mimeType,
  });
  publishedByContent.set(key, published);
  return published;
}

function canonicalMcpResourceBlock(record: Record<string, unknown>, published: AgentPublishedResource): unknown {
  const annotations = projectAnnotations(record.annotations);
  return {
    type: "resource",
    resource: {
      uri: published.resourceUri,
      mimeType: published.mime,
      name: published.name,
    },
    ...annotations,
  };
}

function sanitizeMcpEnvelope(value: unknown, publishedByIndex: ReadonlyMap<number, AgentPublishedResource>): unknown {
  const envelope = agentUnknownRecordOrEmpty(value);
  if (!Array.isArray(envelope.content) || publishedByIndex.size === 0) return value;
  return {
    ...envelope,
    content: envelope.content.map((item, index) => {
      const published = publishedByIndex.get(index);
      if (!published) return item;
      const record = agentUnknownRecordOrEmpty(item);
      return canonicalMcpResourceBlock(record, published);
    }),
  };
}

function readBinaryContent(record: Record<string, unknown>): { data: string; mimeType: string } | undefined {
  const data = typeof record.data === "string" ? record.data.trim() : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  return data && mimeType && isBase64(data) ? { data, mimeType } : undefined;
}

function readResourceBlob(value: unknown): { data: string; mimeType: string } | undefined {
  const resource = agentUnknownRecordOrEmpty(value);
  const data = typeof resource.blob === "string" ? resource.blob.trim() : "";
  const mimeType = typeof resource.mimeType === "string" ? resource.mimeType.trim() : "";
  return data && mimeType && isBase64(data) ? { data, mimeType } : undefined;
}

function resourceFileName(mimeType: string): string {
  return `${createAgentUploadId()}.${mediaTypeExtension(mimeType)}`;
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
