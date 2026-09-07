import MarkdownIt from "markdown-it";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Token from "markdown-it/lib/token.mjs";
import type { AgentResourceResolverLike, AgentResolvedResource } from "../Resources/AgentResourceResolver.js";
import { normalizeAgentResourceUri } from "../Resources/AgentResourceUri.js";
import type { AgentChannelMedia } from "./AgentChannelTypes.js";

/** Bounded policy for media projected from model and tool output. */
export const AgentChannelOutboundMediaDefaults = Object.freeze({
  maxMedia: 8,
  maxInlineBytes: 16 * 1024 * 1024,
  maxScannedCharacters: 128 * 1024,
  maxResourceManifestEntries: 32,
  maxResourceManifestValueLength: 4_096,
  maxValueDepth: 8,
  maxValueNodes: 512,
});

export interface AgentChannelOutboundMediaOptions {
  readonly resourceResolver?: AgentResourceResolverLike;
  readonly maxMedia?: number;
  readonly maxInlineBytes?: number;
}

export interface AgentChannelOutboundMediaProjection {
  readonly caption: string;
  readonly media: readonly AgentChannelMedia[];
  /** Ordered channel payload. Text and native media retain their source order. */
  readonly segments: readonly AgentChannelOutboundSegment[];
}

/**
 * Host-derived description of one explicit Markdown image reference. The
 * original source is retained so the final serializer can preserve wording;
 * resolved values are hints for selecting the correct outbound resource.
 * Unresolved references are intentionally represented instead of guessed.
 */
export type AgentChannelMarkdownResourceReference =
  | {
      readonly source: string;
      readonly kind: "senera";
      readonly resourceUri: string;
      readonly name?: string;
      readonly mime?: string;
    }
  | {
      readonly source: string;
      readonly kind: "http";
      readonly url: string;
    }
  | {
      readonly source: string;
      readonly kind: "workspace";
      readonly absolutePath: string;
      readonly name: string;
      readonly mime: string;
    }
  | {
      readonly source: string;
      readonly kind: "unresolved";
    };

export interface AgentChannelMarkdownResourceManifest {
  readonly references: readonly AgentChannelMarkdownResourceReference[];
}

export interface AgentChannelMarkdownResourceManifestOptions {
  readonly resourceResolver?: AgentResourceResolverLike;
  readonly maxEntries?: number;
}

export type AgentChannelOutboundSegment =
  { readonly kind: "text"; readonly content: string } | { readonly kind: "media"; readonly media: AgentChannelMedia };

/** Structured final payload returned by the host-owned channel rewriter. */
export type AgentChannelFinalPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "resource"; readonly uri: string; readonly alt?: string }
  | { readonly kind: "code"; readonly language?: string; readonly code: string };

interface ReferenceHints {
  readonly imageHint?: boolean;
  readonly mediaKind?: AgentChannelMedia["kind"];
  /** Some adapters (QQ) require SVG to be uploaded as a file even though its MIME is image/svg+xml. */
  readonly allowMediaKindMismatch?: boolean;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly altText?: string;
}

interface TextReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface MarkdownImageSpan {
  readonly start: number;
  readonly end: number;
  readonly destination: string;
  readonly altText: string;
}

interface MarkdownImageOccurrence {
  readonly token: Token;
  readonly span: MarkdownImageSpan;
}

const MarkdownParser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

/**
 * Projects channel-safe native media without exposing arbitrary model paths.
 * Local paths are accepted only after the host resource resolver authorizes the
 * workspace boundary; canonical Senera resources retain their URI identity.
 */
export async function projectAgentChannelOutboundMedia(
  content: string,
  options: AgentChannelOutboundMediaOptions = {},
): Promise<AgentChannelOutboundMediaProjection> {
  const collector = new OutboundMediaCollector(options);
  const replacements: TextReplacement[] = [];
  const projectedImages: Array<{ span: MarkdownImageSpan; media: AgentChannelMedia }> = [];

  // Keep parsing bounded. A large answer remains fully available as text, but
  // only its leading window is eligible for native media projection.
  const scannedContent = content.slice(0, AgentChannelOutboundMediaDefaults.maxScannedCharacters);
  for (const occurrence of readMarkdownImageOccurrences(scannedContent)) {
    const target = getTokenAttribute(occurrence.token, "src");
    if (!target) continue;
    const media = await collector.addReference(target, {
      imageHint: true,
      altText: boundedAltText(occurrence.span.altText || occurrence.token.content),
    });
    if (!media) continue;
    // Native media already carries the visual payload. Keeping the alt text in
    // the caption makes QQ show the same information twice, so remove the
    // complete Markdown image node from the text projection.
    replacements.push({ ...markdownImageRemovalSpan(scannedContent, occurrence.span), text: "" });
    projectedImages.push({ span: occurrence.span, media });
  }

  const caption = applyReplacements(content, replacements);
  return {
    caption: normalizeCaption(caption),
    media: collector.media,
    segments: projectOrderedSegments(content, projectedImages),
  };
}

/**
 * Describes explicit Markdown image targets for the host-owned final
 * serializer. This is deliberately separate from media delivery: the model
 * gets a bounded, verifiable mapping while the adapter still performs the
 * final upload and capability checks.
 */
export async function collectAgentChannelMarkdownResourceManifest(
  content: string,
  options: AgentChannelMarkdownResourceManifestOptions = {},
): Promise<AgentChannelMarkdownResourceManifest> {
  const maxEntries = positiveBound(options.maxEntries ?? AgentChannelOutboundMediaDefaults.maxResourceManifestEntries);
  const scannedContent = content.slice(0, AgentChannelOutboundMediaDefaults.maxScannedCharacters);
  const references: AgentChannelMarkdownResourceReference[] = [];
  const seen = new Set<string>();

  for (const occurrence of readMarkdownImageOccurrences(scannedContent)) {
    if (references.length >= maxEntries) break;
    const source = normalizeMarkdownReference(occurrence.span.destination);
    if (!source || !isManifestValue(source) || seen.has(source)) continue;
    seen.add(source);

    const reference = await describeMarkdownResourceReference(source, options.resourceResolver);
    if (reference) references.push(reference);
  }

  return { references };
}

async function describeMarkdownResourceReference(
  source: string,
  resolver: AgentResourceResolverLike | undefined,
): Promise<AgentChannelMarkdownResourceReference | undefined> {
  if (parseInlineData(source)) return undefined;

  const resourceUri = normalizeAgentResourceUri(source);
  if (resourceUri) {
    if (!isManifestValue(resourceUri)) return undefined;
    if (!resolver) return { source, kind: "unresolved" };
    try {
      const resolved = await resolver.resolve(resourceUri);
      if (resolved) {
        if (!isManifestValue(resolved.resourceUri)) return undefined;
        return {
          source,
          kind: "senera",
          resourceUri: resolved.resourceUri,
          ...(boundedOptionalManifestValue(resolved.name) ? { name: resolved.name } : {}),
          ...(boundedOptionalManifestValue(resolved.mime) ? { mime: resolved.mime } : {}),
        };
      }
    } catch {
      // Resolution failures are represented as unresolved data below. The
      // finalizer must never infer a resource identity from a failed lookup.
    }
    return { source, kind: "unresolved" };
  }

  if (isHttpUrl(source)) return { source, kind: "http", url: source };

  const workspacePath = normalizeWorkspacePathReference(source);
  if (!workspacePath) return undefined;
  if (!resolver?.resolveWorkspacePath) return { source, kind: "unresolved" };

  try {
    const resolved = await resolver.resolveWorkspacePath(workspacePath);
    if (resolved) {
      if (!isManifestValue(resolved.filePath) || !isManifestValue(resolved.name) || !isManifestValue(resolved.mime)) {
        return undefined;
      }
      return {
        source,
        kind: "workspace",
        absolutePath: resolved.filePath,
        name: resolved.name,
        mime: resolved.mime,
      };
    }
  } catch {
    // Missing, external, or unauthorized paths remain ordinary text.
  }
  return { source, kind: "unresolved" };
}

function normalizeMarkdownReference(value: string): string {
  return value.trim().replace(/^<|>$/gu, "");
}

function isManifestValue(value: string): boolean {
  return value.length <= AgentChannelOutboundMediaDefaults.maxResourceManifestValueLength;
}

function boundedOptionalManifestValue(value: string | undefined): string | undefined {
  if (!value || !isManifestValue(value)) return undefined;
  return value;
}

/** Resolves structured final parts while also normalizing media accidentally
 * left inside a text part by a provider. The Markdown parser is shared with
 * the legacy projection path, so a malformed serializer response cannot make
 * an otherwise resolvable image degrade to literal Markdown in QQ. */
export async function projectAgentChannelFinalParts(
  parts: readonly AgentChannelFinalPart[],
  options: AgentChannelOutboundMediaOptions = {},
): Promise<AgentChannelOutboundMediaProjection> {
  const collector = new OutboundMediaCollector(options);
  const segments: AgentChannelOutboundSegment[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      // Structured parts are explicit delivery boundaries. Keep each text
      // part separate, but still extract a Markdown image if a provider put
      // one in a text part instead of returning a resource part.
      const projectedImages: Array<{ span: MarkdownImageSpan; media: AgentChannelMedia }> = [];
      for (const occurrence of readMarkdownImageOccurrences(part.text)) {
        const target = getTokenAttribute(occurrence.token, "src");
        if (!target) continue;
        const media = await collector.addReference(target, {
          imageHint: true,
          altText: boundedAltText(occurrence.span.altText || occurrence.token.content),
        });
        if (media) projectedImages.push({ span: occurrence.span, media });
      }
      if (projectedImages.length > 0) {
        segments.push(...projectOrderedSegments(part.text, projectedImages));
      } else {
        pushTextSegment(segments, part.text);
      }
      continue;
    }
    if (part.kind === "resource") {
      const media = await collector.addReference(part.uri, { altText: boundedAltText(part.alt ?? "") });
      if (media) {
        segments.push({ kind: "media", media });
      } else {
        pushTextSegment(segments, part.alt ? `${part.alt}\n${part.uri}` : part.uri);
      }
      continue;
    }
    if (part.language?.trim().toLowerCase() === "svg") {
      const code = part.code;
      const data = `data:image/svg+xml;base64,${Buffer.from(code, "utf8").toString("base64")}`;
      const media = await collector.addReference(data, {
        mediaKind: "file",
        allowMediaKindMismatch: true,
        mimeType: "image/svg+xml",
        fileName: "senera-artifact.svg",
      });
      if (media) {
        segments.push({ kind: "media", media });
      } else {
        pushTextSegment(segments, code);
      }
      continue;
    }
    pushTextSegment(segments, part.code);
  }
  const caption = segments
    .filter((segment): segment is Extract<AgentChannelOutboundSegment, { kind: "text" }> => segment.kind === "text")
    .map((segment) => segment.content)
    .join("\n");
  return { caption: normalizeCaption(caption), media: collector.media, segments };
}

/** Extracts native media from a raw tool/MCP result. Text is intentionally not
 * returned here: tool progress already names the invocation and the channel
 * should receive the image as a focused native attachment. */
export async function projectAgentChannelMediaFromValue(
  value: unknown,
  options: AgentChannelOutboundMediaOptions = {},
): Promise<AgentChannelOutboundMediaProjection> {
  const collector = new OutboundMediaCollector(options);
  const seen = new WeakSet<object>();
  const state = { depth: 0, nodes: 0 };
  await collectMediaValue(value, collector, seen, state, {});
  return {
    caption: "",
    media: collector.media,
    segments: collector.media.map((media) => ({ kind: "media", media }) satisfies AgentChannelOutboundSegment),
  };
}

function projectOrderedSegments(
  content: string,
  images: readonly { span: MarkdownImageSpan; media: AgentChannelMedia }[],
): AgentChannelOutboundSegment[] {
  if (images.length === 0) {
    const text = normalizeCaption(content);
    return text ? [{ kind: "text", content: text }] : [];
  }
  const segments: AgentChannelOutboundSegment[] = [];
  const emittedMedia = new Set<string>();
  let cursor = 0;
  for (const image of [...images].sort((left, right) => left.span.start - right.span.start)) {
    appendMergedTextSegment(segments, content.slice(cursor, image.span.start));
    const mediaKey = agentChannelMediaIdentity(image.media);
    if (!emittedMedia.has(mediaKey)) {
      emittedMedia.add(mediaKey);
      segments.push({ kind: "media", media: image.media });
    }
    cursor = image.span.end;
  }
  appendMergedTextSegment(segments, content.slice(cursor));
  return segments;
}

function markdownImageRemovalSpan(content: string, span: MarkdownImageSpan): Pick<TextReplacement, "start" | "end"> {
  const lineStart = content.lastIndexOf("\n", span.start - 1) + 1;
  const lineEnd = content.indexOf("\n", span.end);
  const lineEndOffset = lineEnd >= 0 ? lineEnd : content.length;
  const before = content.slice(lineStart, span.start).trim();
  const after = content.slice(span.end, lineEndOffset).trim();
  if (before || after) return { start: span.start, end: span.end };
  if (lineEnd >= 0) return { start: span.start, end: lineEnd + 1 };
  return { start: lineStart > 0 ? lineStart - 1 : span.start, end: span.end };
}

function pushTextSegment(segments: AgentChannelOutboundSegment[], value: string): void {
  const content = normalizeCaption(value);
  if (!content) return;
  segments.push({ kind: "text", content });
}

/**
 * Legacy Markdown projection treats the remaining caption as one authored
 * text stream. Keep its historical coalescing behavior for the fallback path;
 * structured final parts use pushTextSegment so their boundaries survive.
 */
function appendMergedTextSegment(segments: AgentChannelOutboundSegment[], value: string): void {
  const content = normalizeCaption(value);
  if (!content) return;
  const previous = segments.at(-1);
  if (previous?.kind === "text") {
    segments[segments.length - 1] = { kind: "text", content: `${previous.content}\n${content}` };
    return;
  }
  pushTextSegment(segments, content);
}

class OutboundMediaCollector {
  private readonly resolver?: AgentResourceResolverLike;
  private readonly maxMedia: number;
  private readonly maxInlineBytes: number;
  private readonly seen = new Map<string, AgentChannelMedia>();
  readonly media: AgentChannelMedia[] = [];

  constructor(options: AgentChannelOutboundMediaOptions) {
    this.resolver = options.resourceResolver;
    this.maxMedia = positiveBound(options.maxMedia ?? AgentChannelOutboundMediaDefaults.maxMedia);
    this.maxInlineBytes = positiveBound(options.maxInlineBytes ?? AgentChannelOutboundMediaDefaults.maxInlineBytes);
  }

  async addReference(value: string, hints: ReferenceHints = {}): Promise<AgentChannelMedia | undefined> {
    const reference = value.trim().replace(/^<|>$/gu, "");
    if (!reference) return undefined;

    const inline = parseInlineData(reference);
    if (inline) {
      const kind = resolveMediaKind(inline.mime, hints.mediaKind, hints.allowMediaKindMismatch);
      if (!kind || (hints.imageHint === true && kind !== "image")) return undefined;
      if (inline.encodedLength * 0.75 > this.maxInlineBytes) return undefined;
      return this.addMedia({
        kind,
        data: inline.data,
        contentHash: contentHashForDataUri(inline.data),
        contentType: inline.mime,
        filename: hints.fileName ?? `senera-media-${this.media.length + 1}.${extensionForMime(inline.mime)}`,
        altText: hints.altText,
      });
    }

    const resourceUri = normalizeAgentResourceUri(reference);
    if (resourceUri) {
      if (!this.resolver) return undefined;
      let resolved: AgentResolvedResource | undefined;
      try {
        resolved = await this.resolver.resolve(resourceUri);
      } catch {
        return undefined;
      }
      if (!resolved) return undefined;
      const kind = resolveMediaKind(resolved.mime, hints.mediaKind, hints.allowMediaKindMismatch);
      if (!kind || (hints.imageHint === true && kind !== "image")) return undefined;
      return this.addMedia({
        kind,
        resourceUri: resolved.resourceUri,
        contentHash: resolved.sha256,
        path: resolved.filePath,
        contentType: resolved.mime,
        filename: hints.fileName ?? resolved.name,
        altText: hints.altText,
      });
    }

    const workspacePath = normalizeWorkspacePathReference(reference);
    if (workspacePath && this.resolver?.resolveWorkspacePath) {
      let resolved: Awaited<ReturnType<NonNullable<AgentResourceResolverLike["resolveWorkspacePath"]>>>;
      try {
        resolved = await this.resolver.resolveWorkspacePath(workspacePath);
      } catch {
        return undefined;
      }
      if (!resolved) return undefined;
      const kind = resolveMediaKind(resolved.mime, hints.mediaKind, hints.allowMediaKindMismatch);
      if (!kind || (hints.imageHint === true && kind !== "image")) return undefined;
      return this.addMedia({
        kind,
        path: resolved.filePath,
        contentHash: resolved.sha256,
        contentType: resolved.mime,
        filename: hints.fileName ?? resolved.name,
        altText: hints.altText,
      });
    }

    if (!isHttpUrl(reference)) return undefined;
    const mime = normalizeMime(hints.mimeType);
    const kind = resolveUrlMediaKind(reference, mime, hints);
    if (!kind) return undefined;
    return this.addMedia({
      kind,
      url: reference,
      ...(mime ? { contentType: mime } : {}),
      ...(hints.fileName ? { filename: hints.fileName } : {}),
      ...(hints.altText ? { altText: hints.altText } : {}),
    });
  }

  addInlineBase64(data: string, hints: ReferenceHints): AgentChannelMedia | undefined {
    const normalized = data.trim().replace(/\s+/gu, "");
    if (!normalized || !isBase64(normalized)) return undefined;
    const mime = normalizeMime(hints.mimeType);
    if (!mime) return undefined;
    const kind = resolveMediaKind(mime, hints.mediaKind, hints.allowMediaKindMismatch);
    if (!kind || (hints.imageHint === true && kind !== "image")) return undefined;
    const estimatedBytes = Math.floor((normalized.length * 3) / 4);
    if (estimatedBytes > this.maxInlineBytes) return undefined;
    const dataUri = `data:${mime};base64,${normalized}`;
    return this.addMedia({
      kind,
      data: dataUri,
      contentHash: contentHashForDataUri(dataUri),
      contentType: mime,
      filename: hints.fileName ?? `senera-media-${this.media.length + 1}.${extensionForMime(mime)}`,
      altText: hints.altText,
    });
  }

  private addMedia(media: AgentChannelMedia): AgentChannelMedia | undefined {
    const key = agentChannelMediaIdentity(media);
    const existing = this.seen.get(key);
    if (existing) return existing;
    if (this.media.length >= this.maxMedia) return undefined;
    this.seen.set(key, media);
    this.media.push(media);
    return media;
  }
}

async function collectMediaValue(
  value: unknown,
  collector: OutboundMediaCollector,
  seen: WeakSet<object>,
  state: { depth: number; nodes: number },
  hints: ReferenceHints,
): Promise<void> {
  if (
    state.depth > AgentChannelOutboundMediaDefaults.maxValueDepth ||
    state.nodes >= AgentChannelOutboundMediaDefaults.maxValueNodes
  ) {
    return;
  }
  if (typeof value === "string") {
    await collectMediaText(value, collector, hints);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  state.nodes += 1;

  if (Array.isArray(value)) {
    for (const entry of value) {
      state.depth += 1;
      await collectMediaValue(entry, collector, seen, state, hints);
      state.depth -= 1;
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const type = stringValue(record.type)?.toLowerCase();
  const mime = normalizeMime(
    stringValue(record.mimeType) ?? stringValue(record.mediaType) ?? stringValue(record.contentType),
  );
  const fileName = hints.fileName ?? stringValue(record.fileName) ?? stringValue(record.filename);
  const declaredKind = mediaKindForType(type) ?? hints.mediaKind;
  const imageHint = hints.imageHint === true || declaredKind === "image" || isImageKey(fileName);
  const mediaKind = declaredKind ?? mediaKindForMime(mime);
  const altText = hints.altText ?? stringValue(record.alt) ?? stringValue(record.altText) ?? stringValue(record.name);

  const directData = stringValue(record.dataBase64) ?? stringValue(record.base64) ?? stringValue(record.blob);
  if (directData && mime && mediaKind)
    collector.addInlineBase64(directData, { mimeType: mime, mediaKind, fileName, altText, imageHint });
  const data = stringValue(record.data);
  if (data) {
    if (parseInlineData(data)) {
      await collector.addReference(data, { imageHint, mediaKind, mimeType: mime, fileName, altText });
    } else if (mime && mediaKind && (imageHint || type !== undefined)) {
      collector.addInlineBase64(data, { mimeType: mime, mediaKind, fileName, altText, imageHint });
    }
  }

  for (const [key, child] of Object.entries(record)) {
    const keyHint = imageHint || isImageKey(key);
    const childHints: ReferenceHints = {
      imageHint: keyHint,
      mediaKind,
      mimeType: mime,
      fileName: fileName ?? (keyHint ? stringValue(record.name) : undefined),
      altText,
    };
    if (typeof child === "string") {
      if (key === "data" || key === "dataBase64" || key === "base64" || key === "blob") continue;
      if (isMediaReferenceKey(key)) {
        await collector.addReference(child, childHints);
        continue;
      }
      await collectMediaText(child, collector, childHints);
      continue;
    }
    state.depth += 1;
    await collectMediaValue(child, collector, seen, state, childHints);
    state.depth -= 1;
  }
}

async function collectMediaText(
  value: string,
  collector: OutboundMediaCollector,
  hints: ReferenceHints,
): Promise<void> {
  const text = value.slice(0, AgentChannelOutboundMediaDefaults.maxScannedCharacters);
  const inline = parseInlineData(text);
  if (inline && (hints.imageHint === true || resolveMediaKind(inline.mime, hints.mediaKind) !== "file")) {
    await collector.addReference(text, {
      ...hints,
      mediaKind: hints.mediaKind ?? mediaKindForMime(inline.mime),
    });
    return;
  }
  const resourceUri = normalizeAgentResourceUri(text);
  if (resourceUri) {
    await collector.addReference(resourceUri, { ...hints, imageHint: hints.imageHint ?? false });
    return;
  }
  for (const occurrence of readMarkdownImageOccurrences(text)) {
    const target = getTokenAttribute(occurrence.token, "src");
    if (!target) continue;
    await collector.addReference(target, {
      ...hints,
      imageHint: true,
      mediaKind: "image",
      altText: boundedAltText(occurrence.span.altText || occurrence.token.content) || hints.altText,
    });
  }
}

function readMarkdownImageOccurrences(content: string): MarkdownImageOccurrence[] {
  const tokens = MarkdownParser.parse(content, {});
  const lineOffsets = readLineOffsets(content);
  const occurrences: MarkdownImageOccurrence[] = [];

  for (const token of tokens) {
    if (token.type !== "inline" || !token.children?.length) continue;
    const range = inlineSourceRange(content, token, lineOffsets);
    if (!range) continue;
    let cursor = range.start;
    for (const child of token.children) {
      if (child.type !== "image") continue;
      const source = getTokenAttribute(child, "src");
      if (!source) continue;
      const span = findMarkdownImageSpan(content, range.end, cursor, source);
      if (!span) continue;
      occurrences.push({ token: child, span });
      cursor = span.end;
    }
  }

  return occurrences;
}

function inlineSourceRange(
  content: string,
  token: Token,
  lineOffsets: readonly number[],
): { start: number; end: number } | undefined {
  const map = token.map;
  if (!map || map.length < 2) return undefined;
  const start = lineOffsets[map[0]] ?? 0;
  const end = lineOffsets[map[1]] ?? content.length;
  if (end < start) return undefined;
  const exact = token.content ? content.indexOf(token.content, start) : start;
  if (exact >= start && exact + token.content.length <= end) {
    return { start: exact, end: exact + token.content.length };
  }
  // Block prefixes (list markers, blockquote markers and indentation) are not
  // part of token.content. The line range still bounds all image syntax.
  return { start, end };
}

function findMarkdownImageSpan(
  content: string,
  rangeEnd: number,
  cursor: number,
  source: string,
): MarkdownImageSpan | undefined {
  let candidate = content.indexOf("![", cursor);
  while (candidate >= 0 && candidate < rangeEnd) {
    const span = parseMarkdownImageSpan(content, candidate, rangeEnd);
    if (span && sameMarkdownDestination(span.destination, source)) return span;
    candidate = content.indexOf("![", candidate + 2);
  }
  return undefined;
}

function parseMarkdownImageSpan(content: string, start: number, rangeEnd: number): MarkdownImageSpan | undefined {
  let cursor = start + 2;
  const labelEnd = readBalancedDelimiter(content, cursor, rangeEnd, "[", "]");
  if (labelEnd === undefined) return undefined;
  cursor = labelEnd + 1;
  cursor = skipWhitespace(content, cursor, rangeEnd);
  if (content[cursor] !== "(") return undefined;
  const destinationStart = skipWhitespace(content, cursor + 1, rangeEnd);
  let destination: string;
  let destinationEnd: number;
  if (content[destinationStart] === "<") {
    const close = readEscapedDelimiter(content, destinationStart + 1, rangeEnd, ">");
    if (close === undefined) return undefined;
    destination = content.slice(destinationStart + 1, close);
    destinationEnd = close + 1;
  } else {
    const close = readLinkDestinationEnd(content, destinationStart, rangeEnd);
    if (!close) return undefined;
    destination = content.slice(destinationStart, close.end);
    destinationEnd = close.end;
  }

  let end = skipWhitespace(content, destinationEnd, rangeEnd);
  if (content[end] !== ")") {
    const titleEnd = readOptionalLinkTitle(content, end, rangeEnd);
    if (titleEnd === undefined) return undefined;
    end = skipWhitespace(content, titleEnd, rangeEnd);
  }
  if (content[end] !== ")") return undefined;
  return {
    start,
    end: end + 1,
    destination: unescapeMarkdownDestination(destination.trim()),
    altText: content.slice(start + 2, labelEnd),
  };
}

function readBalancedDelimiter(
  content: string,
  start: number,
  rangeEnd: number,
  open: string,
  close: string,
): number | undefined {
  let depth = 1;
  for (let cursor = start; cursor < rangeEnd; cursor += 1) {
    const character = content[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    if (character === "\n" && depth === 1) return undefined;
  }
  return undefined;
}

function readEscapedDelimiter(content: string, start: number, rangeEnd: number, delimiter: string): number | undefined {
  for (let cursor = start; cursor < rangeEnd; cursor += 1) {
    if (content[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (content[cursor] === delimiter || content[cursor] === "\n") {
      return content[cursor] === delimiter ? cursor : undefined;
    }
  }
  return undefined;
}

function readLinkDestinationEnd(content: string, start: number, rangeEnd: number): { end: number } | undefined {
  let depth = 0;
  for (let cursor = start; cursor < rangeEnd; cursor += 1) {
    const character = content[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) return { end: cursor };
      depth -= 1;
      continue;
    }
    if (depth === 0 && (character === "\n" || isWhitespace(character))) return { end: cursor };
  }
  return depth === 0 ? { end: rangeEnd } : undefined;
}

function readOptionalLinkTitle(content: string, start: number, rangeEnd: number): number | undefined {
  const cursor = skipWhitespace(content, start, rangeEnd);
  const marker = content[cursor];
  if (marker !== '"' && marker !== "'" && marker !== "(") return undefined;
  const close = marker === "(" ? ")" : marker;
  return readEscapedDelimiter(content, cursor + 1, rangeEnd, close);
}

function skipWhitespace(content: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && isWhitespace(content[cursor])) cursor += 1;
  return cursor;
}

function isWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

function readLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let cursor = 0; cursor < content.length; cursor += 1) {
    if (content[cursor] === "\n") offsets.push(cursor + 1);
  }
  return offsets;
}

function getTokenAttribute(token: Token, name: string): string | undefined {
  const value = token.attrGet(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameMarkdownDestination(left: string, right: string): boolean {
  return unescapeMarkdownDestination(left.trim()) === unescapeMarkdownDestination(right.trim());
}

function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function applyReplacements(content: string, replacements: readonly TextReplacement[]): string {
  if (replacements.length === 0) return content;
  const ordered = [...replacements].sort((left, right) => right.start - left.start);
  let result = content;
  for (const replacement of ordered)
    result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
  return result;
}

function normalizeCaption(content: string): string {
  return content
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function parseInlineData(value: string): { mime: string; data: string; encodedLength: number } | undefined {
  const match = /^data:([^;,\s]+);base64,([a-z0-9+/=\s]+)$/iu.exec(value.trim());
  if (!match) return undefined;
  const mime = normalizeMime(match[1]);
  const encoded = match[2].replace(/\s+/gu, "");
  if (!mime || !isBase64(encoded)) return undefined;
  return {
    mime,
    data: `data:${mime};base64,${encoded}`,
    encodedLength: encoded.length,
  };
}

function isBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeWorkspacePathReference(value: string): string | undefined {
  const reference = value.trim();
  if (!reference) return undefined;

  if (reference.startsWith("file:")) {
    try {
      return fileURLToPath(reference);
    } catch {
      return undefined;
    }
  }

  // Markdown parsers preserve a leading slash in Windows drive paths written
  // as `</E:/...>`. Convert that representation before the workspace boundary
  // performs its canonical containment check.
  const pathReference = isSlashPrefixedWindowsDrivePath(reference) ? reference.slice(1) : reference;

  // URL references are handled by the remote-media route below. A protocol
  // relative URL is also not a workspace path, even though it starts with a
  // slash on every platform.
  if (isHttpUrl(reference) || reference.startsWith("//")) return undefined;

  // Test native path forms before URL protocol detection. On Windows,
  // `new URL("E:/file.svg")` reports `e:` as a protocol even though it is a
  // local drive path.
  if (path.isAbsolute(pathReference) || path.win32.isAbsolute(pathReference) || path.posix.isAbsolute(pathReference)) {
    return decodePathReference(pathReference);
  }

  if (hasUrlScheme(reference)) return undefined;

  // Relative references are intentionally accepted here. The resolver, not
  // this parser, anchors them to the configured workspace and rejects missing,
  // external, and link-traversing paths.
  return decodePathReference(pathReference);
}

function hasUrlScheme(value: string): boolean {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

function isSlashPrefixedWindowsDrivePath(value: string): boolean {
  return value.length >= 3 && value[0] === "/" && isAsciiLetter(value.charCodeAt(1)) && value[2] === ":";
}

function isAsciiLetter(value: number): boolean {
  return (value >= 65 && value <= 90) || (value >= 97 && value <= 122);
}

function decodePathReference(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function resolveUrlMediaKind(
  value: string,
  mime: string | undefined,
  hints: ReferenceHints,
): AgentChannelMedia["kind"] | undefined {
  const inferred = mediaKindForMime(mime) ?? mediaKindForUrl(value);
  const kind = hints.mediaKind ?? inferred ?? (hints.imageHint ? "image" : undefined);
  if (inferred && kind !== inferred) return undefined;
  return kind;
}

function mediaKindForMime(value: string | undefined): AgentChannelMedia["kind"] | undefined {
  const mime = normalizeMime(value);
  if (!mime) return undefined;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function resolveMediaKind(
  mime: string | undefined,
  hinted: AgentChannelMedia["kind"] | undefined,
  allowMismatch = false,
): AgentChannelMedia["kind"] | undefined {
  const inferred = mediaKindForMime(mime);
  if (inferred && hinted && inferred !== hinted && !allowMismatch) return undefined;
  return hinted ?? inferred;
}

function mediaKindForType(value: string | undefined): AgentChannelMedia["kind"] | undefined {
  switch (value) {
    case "image":
    case "image_url":
    case "imageurl":
      return "image";
    case "video":
    case "video_url":
    case "videourl":
      return "video";
    case "audio":
    case "audio_url":
    case "audiourl":
      return "audio";
    case "file":
    case "file_url":
    case "fileurl":
      return "file";
    default:
      return undefined;
  }
}

function mediaKindForUrl(value: string): AgentChannelMedia["kind"] | undefined {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    for (const [kind, extensions] of Object.entries(MediaExtensions)) {
      if (extensions.some((extension) => pathname.endsWith(extension))) return kind as AgentChannelMedia["kind"];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const MediaExtensions = Object.freeze({
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico", ".heic"],
  video: [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"],
  audio: [".aac", ".amr", ".flac", ".m4a", ".mp3", ".ogg", ".silk", ".speex", ".wav"],
  file: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".txt"],
} as const);

function normalizeMime(value: string | undefined): string | undefined {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function isImageKey(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return ["image", "img", "screenshot", "thumbnail", "picture", "photo", "avatar", "cover", "icon"].some((part) =>
    normalized.includes(part),
  );
}

function isMediaReferenceKey(value: string): boolean {
  return MediaReferenceKeys.has(value.toLowerCase());
}

const MediaReferenceKeys = new Set([
  "uri",
  "resourceuri",
  "url",
  "image_url",
  "imageurl",
  "video_url",
  "videourl",
  "audio_url",
  "audiourl",
  "file_url",
  "fileurl",
]);

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedAltText(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 160);
}

function extensionForMime(mime: string): string {
  const subtype = mime.split("/", 2)[1]?.replace(/[^a-z0-9]+/giu, "");
  return subtype || "png";
}

export function agentChannelMediaIdentity(media: AgentChannelMedia): string {
  if (media.contentHash) return `hash:${media.kind}:${media.contentHash.toLowerCase()}`;
  if (media.resourceUri) return `resource:${media.resourceUri}`;
  if (media.path) return `path:${media.path}`;
  if (media.url) return `url:${media.url}`;
  if (media.data) {
    const dataHash = contentHashForDataUri(media.data);
    if (dataHash) return `hash:${media.kind}:${dataHash}`;
    return `data:${media.contentType ?? "image"}:${media.data.length}:${media.data.slice(0, 48)}:${media.data.slice(-48)}`;
  }
  return `media:${media.kind}:${media.filename ?? ""}`;
}

function contentHashForDataUri(value: string): string | undefined {
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/iu.exec(value.trim());
  if (!match) return undefined;
  try {
    return createHash("sha256")
      .update(Buffer.from(match[1].replace(/\s+/gu, ""), "base64"))
      .digest("hex");
  } catch {
    return undefined;
  }
}

function positiveBound(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}
