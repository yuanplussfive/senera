import type { AgentChannelChatType, AgentChannelKind } from "./AgentChannelTypes.js";
import type { AgentChannelFinalPart, AgentChannelMarkdownResourceManifest } from "./AgentChannelOutboundMedia.js";

/**
 * Channel rewrite history is persisted as a small learning context, not as a
 * second transcript. Keeping it bounded prevents a sequence of large media
 * answers from becoming the next model request by accident.
 */
export const AgentChannelFinalizationDefaults = Object.freeze({
  maxRecords: 8,
  maxContentCharacters: 12_000,
  maxParts: 32,
  maxPartCharacters: 8_192,
  maxManifestEntries: 32,
  maxManifestValueCharacters: 4_096,
});

export interface AgentChannelFinalizationRecord {
  readonly id: string;
  readonly requestId?: string;
  readonly createdAt: string;
  readonly platform: AgentChannelKind;
  readonly chatType: AgentChannelChatType;
  readonly logicalCacheScope?: string;
  readonly content: string;
  readonly parts: readonly AgentChannelFinalPart[];
  readonly resourceManifest?: AgentChannelMarkdownResourceManifest;
}

export interface AgentChannelFinalizationMetadata {
  readonly version: 1;
  readonly records: readonly AgentChannelFinalizationRecord[];
}

export function appendAgentChannelFinalizationRecord(
  current: AgentChannelFinalizationMetadata | undefined,
  record: AgentChannelFinalizationRecord,
): AgentChannelFinalizationMetadata {
  const next = normalizeAgentChannelFinalizationRecord(record);
  const previous = current?.version === 1 && Array.isArray(current.records) ? current.records : [];
  const withoutDuplicate = previous.filter((candidate) => candidate.id !== next.id);
  return {
    version: 1,
    records: [...withoutDuplicate, next].slice(-AgentChannelFinalizationDefaults.maxRecords),
  };
}

export function readAgentChannelFinalizationHistory(
  metadata: AgentChannelFinalizationMetadata | undefined,
): readonly AgentChannelFinalizationRecord[] {
  if (metadata?.version !== 1 || !Array.isArray(metadata.records)) return [];
  return metadata.records
    .filter((record): record is AgentChannelFinalizationRecord => isFinalizationRecord(record))
    .slice(-AgentChannelFinalizationDefaults.maxRecords);
}

function normalizeAgentChannelFinalizationRecord(
  record: AgentChannelFinalizationRecord,
): AgentChannelFinalizationRecord {
  return {
    id: record.id.trim(),
    ...(record.requestId?.trim() ? { requestId: record.requestId.trim() } : {}),
    createdAt: record.createdAt,
    platform: record.platform,
    chatType: record.chatType,
    ...(record.logicalCacheScope?.trim() ? { logicalCacheScope: record.logicalCacheScope.trim() } : {}),
    content: record.content.slice(0, AgentChannelFinalizationDefaults.maxContentCharacters),
    parts: record.parts.slice(0, AgentChannelFinalizationDefaults.maxParts).flatMap((part): AgentChannelFinalPart[] => {
      if (part.kind === "text") {
        const text = part.text.slice(0, AgentChannelFinalizationDefaults.maxPartCharacters);
        return text ? [{ kind: "text", text }] : [];
      }
      if (part.kind === "code") {
        const code = part.code.slice(0, AgentChannelFinalizationDefaults.maxPartCharacters);
        return code
          ? [{ kind: "code", ...(part.language?.trim() ? { language: part.language.trim().slice(0, 64) } : {}), code }]
          : [];
      }
      const uri = part.uri.trim().slice(0, AgentChannelFinalizationDefaults.maxManifestValueCharacters);
      return uri
        ? [
            {
              kind: "resource",
              uri,
              ...(part.alt?.trim() ? { alt: part.alt.trim().slice(0, 512) } : {}),
            },
          ]
        : [];
    }),
    ...(record.resourceManifest
      ? {
          resourceManifest: {
            references: record.resourceManifest.references
              .slice(0, AgentChannelFinalizationDefaults.maxManifestEntries)
              .flatMap((reference) => normalizeManifestReference(reference)),
          },
        }
      : {}),
  };
}

function normalizeManifestReference(
  reference: AgentChannelMarkdownResourceManifest["references"][number],
): AgentChannelMarkdownResourceManifest["references"][number][] {
  const source = reference.source.trim().slice(0, AgentChannelFinalizationDefaults.maxManifestValueCharacters);
  if (!source) return [];
  switch (reference.kind) {
    case "senera": {
      const resourceUri = reference.resourceUri
        .trim()
        .slice(0, AgentChannelFinalizationDefaults.maxManifestValueCharacters);
      return resourceUri
        ? [
            {
              source,
              kind: "senera",
              resourceUri,
              ...(reference.name?.trim() ? { name: reference.name.trim().slice(0, 512) } : {}),
              ...(reference.mime?.trim() ? { mime: reference.mime.trim().slice(0, 256) } : {}),
            },
          ]
        : [];
    }
    case "http": {
      const url = reference.url.trim().slice(0, AgentChannelFinalizationDefaults.maxManifestValueCharacters);
      return url ? [{ source, kind: "http", url }] : [];
    }
    case "workspace": {
      const absolutePath = reference.absolutePath
        .trim()
        .slice(0, AgentChannelFinalizationDefaults.maxManifestValueCharacters);
      const name = reference.name.trim().slice(0, 512);
      const mime = reference.mime.trim().slice(0, 256);
      return absolutePath && name && mime ? [{ source, kind: "workspace", absolutePath, name, mime }] : [];
    }
    case "unresolved":
      return [{ source, kind: "unresolved" }];
  }
}

function isFinalizationRecord(value: unknown): value is AgentChannelFinalizationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AgentChannelFinalizationRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.platform === "string" &&
    typeof record.chatType === "string" &&
    typeof record.content === "string" &&
    Array.isArray(record.parts)
  );
}
