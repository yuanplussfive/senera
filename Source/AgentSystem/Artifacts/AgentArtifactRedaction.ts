import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ToolArtifactPolicyManifest } from "../Types/PluginManifestTypes.js";

const DefaultArtifactRedactionWindowChars = 4_096;
const DefaultArtifactRedactionReplacement = "[REDACTED]";

export interface ResolvedArtifactStreamRedactionTransform {
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly windowChars: number;
}

export function redactArtifactSecrets(value: unknown, policy: ToolArtifactPolicyManifest | undefined): unknown {
  const keyPatterns = (policy?.Redact?.Keys ?? []).map((pattern) => new RegExp(pattern, "i"));
  const pathSelectors = new Set(policy?.Redact?.Paths ?? []);
  return redactValue(value, keyPatterns, pathSelectors, "$", policy);
}

function redactValue(
  value: unknown,
  keyPatterns: readonly RegExp[],
  pathSelectors: ReadonlySet<string>,
  currentPath: string,
  policy: ToolArtifactPolicyManifest | undefined,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const redacted = value.map((entry, index) => {
      const next = redactValue(entry, keyPatterns, pathSelectors, `${currentPath}[${index}]`, policy);
      changed ||= next !== entry;
      return next;
    });
    return changed ? redacted : value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  let redacted: Record<string, unknown> | undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${currentPath}.${key}`;
    const next =
      isSensitiveKey(key, keyPatterns) || pathSelectors.has(childPath)
        ? "[REDACTED]"
        : isArtifactOutputStreamKey(key) && typeof entry === "string"
          ? redactArtifactStreamText(entry, policy, key)
          : redactValue(entry, keyPatterns, pathSelectors, childPath, policy);
    if (next === entry) continue;
    redacted ??= { ...source };
    redacted[key] = next;
  }
  return redacted ?? value;
}

function isArtifactOutputStreamKey(key: string): key is "stdout" | "stderr" {
  return key === "stdout" || key === "stderr";
}

function redactArtifactStreamText(
  value: string,
  policy: ToolArtifactPolicyManifest | undefined,
  stream: "stdout" | "stderr",
): string {
  if (isArtifactStreamFullyRedacted(policy, stream)) return DefaultArtifactRedactionReplacement;
  return resolveArtifactStreamRedactionTransforms(policy, stream).reduce(
    (result, transform) => result.replace(transform.pattern, () => transform.replacement),
    value,
  );
}

function isSensitiveKey(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}

export function isArtifactStreamFullyRedacted(
  policy: ToolArtifactPolicyManifest | undefined,
  stream: "stdout" | "stderr",
): boolean {
  return policy?.Redact?.Streams?.includes(stream) ?? false;
}

export function hasArtifactStreamRedaction(
  policy: ToolArtifactPolicyManifest | undefined,
  stream: "stdout" | "stderr",
): boolean {
  return (
    isArtifactStreamFullyRedacted(policy, stream) || resolveArtifactStreamRedactionTransforms(policy, stream).length > 0
  );
}

export function resolveArtifactStreamRedactionTransforms(
  policy: ToolArtifactPolicyManifest | undefined,
  stream: "stdout" | "stderr",
): readonly ResolvedArtifactStreamRedactionTransform[] {
  return (policy?.Redact?.Transforms ?? [])
    .filter((transform) => transform.Streams === undefined || transform.Streams.includes(stream))
    .map((transform) => {
      const flags = ensureGlobalRegexFlags(transform.Flags);
      const windowChars = transform.WindowChars ?? DefaultArtifactRedactionWindowChars;
      if (!Number.isSafeInteger(windowChars) || windowChars < 1) {
        throw new RangeError("Artifact redaction WindowChars must be a positive safe integer.");
      }
      return {
        pattern: new RegExp(transform.Pattern, flags),
        replacement: transform.Replacement ?? DefaultArtifactRedactionReplacement,
        windowChars,
      };
    });
}

/**
 * Applies declared stream transforms without loading the captured output into
 * memory. Each regex stage retains a bounded boundary window derived from its
 * declared match window so a match split across read chunks is still redacted.
 */
export function createArtifactStreamRedactionTransform(
  policy: ToolArtifactPolicyManifest | undefined,
  stream: "stdout" | "stderr",
): Transform | undefined {
  const transforms = resolveArtifactStreamRedactionTransforms(policy, stream);
  if (transforms.length === 0) return undefined;
  return new ArtifactStreamRedactionTransform(transforms);
}

class ArtifactStreamRedactionTransform extends Transform {
  private readonly decoder = new StringDecoder("utf8");
  private readonly stages: RedactionStage[];

  constructor(transforms: readonly ResolvedArtifactStreamRedactionTransform[]) {
    super();
    this.stages = transforms.map((transform) => new RedactionStage(transform));
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error) => void): void {
    try {
      this.push(this.process(this.decoder.write(chunk), false));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error) => void): void {
    try {
      this.push(this.process(this.decoder.end(), true));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private process(input: string, final: boolean): string {
    return this.stages.reduce((value, stage) => stage.process(value, final), input);
  }
}

class RedactionStage {
  private pending = "";

  constructor(private readonly transform: ResolvedArtifactStreamRedactionTransform) {}

  process(input: string, final: boolean): string {
    this.pending += input;
    if (this.pending.length === 0) return "";

    const boundaryWindow = Math.min(Number.MAX_SAFE_INTEGER, this.transform.windowChars * 2);
    const limit = final
      ? this.pending.length
      : alignCodePointBoundary(this.pending, Math.max(0, this.pending.length - boundaryWindow));
    const regex = new RegExp(this.transform.pattern.source, this.transform.pattern.flags);
    let sourceCursor = 0;
    let retainedFrom = limit;
    let output = "";
    let match: RegExpExecArray | null;

    while ((match = regex.exec(this.pending)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!final && start >= limit) break;
      if (!final && end > limit) {
        if (end - start > this.transform.windowChars) {
          throw new RangeError(
            `Artifact redaction match exceeds WindowChars (${this.transform.windowChars}) for ${this.transform.pattern.source}.`,
          );
        }
        output += this.pending.slice(sourceCursor, start);
        retainedFrom = start;
        sourceCursor = start;
        break;
      }
      output += this.pending.slice(sourceCursor, start);
      output += this.transform.replacement;
      sourceCursor = end;
      if (start === end) regex.lastIndex = end + 1;
    }

    if (retainedFrom === limit) output += this.pending.slice(sourceCursor, limit);
    this.pending = final ? "" : this.pending.slice(retainedFrom);
    return output;
  }
}

function alignCodePointBoundary(value: string, candidate: number): number {
  return candidate > 0 && candidate < value.length && isLowSurrogate(value.charCodeAt(candidate))
    ? candidate - 1
    : candidate;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function ensureGlobalRegexFlags(flags: string | undefined): string {
  const value = flags ?? "";
  if (value.includes("y")) {
    throw new RangeError("Artifact redaction does not support the sticky regex flag.");
  }
  return value.includes("g") ? value : `${value}g`;
}
