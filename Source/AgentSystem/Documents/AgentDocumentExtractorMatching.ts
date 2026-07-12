import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type { AgentDocumentExtractorMatcher } from "./AgentDocumentExtractorTypes.js";

export function matchesProbeSelector(
  probe: AgentDocumentProbeResult,
  matcher: AgentDocumentExtractorMatcher | undefined,
): boolean {
  if (!matcher) {
    return false;
  }

  return [
    matchesAnyMime(probe, matcher.mimes ?? []),
    matchesAnyMimePrefix(probe, matcher.mimePrefixes ?? []),
    matchesAnyExtension(probe, matcher.extensions ?? []),
    matchesAnyMediaType(probe, matcher.mediaTypes ?? []),
    matchesOptionalBoolean(probe.isText, matcher.isText),
    matchesOptionalBoolean(probe.isBinary, matcher.isBinary),
    matchesAnyContainerFormat(probe, matcher.containerFormats ?? []),
  ].some(Boolean);
}

export function collectProbeMimes(probe: AgentDocumentProbeResult): Set<string> {
  return new Set(
    [probe.effectiveMime, probe.detectedMime, probe.declaredMime, probe.namedMime].flatMap((value) =>
      compactNormalizedTokens([value]),
    ),
  );
}

export function collectProbeExtensions(probe: AgentDocumentProbeResult): Set<string> {
  return new Set(
    [probe.detectedExtension, probe.namedExtension].flatMap((value) => compactNormalizedExtensions([value])),
  );
}

export function normalizeToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function normalizeExtension(value: string | undefined): string | undefined {
  const token = normalizeToken(value);
  return token ? (token.startsWith(".") ? token : `.${token}`) : undefined;
}

function matchesAnyMime(probe: AgentDocumentProbeResult, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }

  const mimes = collectProbeMimes(probe);
  return compactNormalizedTokens(values).some((value) => mimes.has(value));
}

function matchesAnyMimePrefix(probe: AgentDocumentProbeResult, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }

  const mimes = [...collectProbeMimes(probe)];
  return compactNormalizedTokens(values).some((prefix) => mimes.some((mime) => mime.startsWith(prefix)));
}

function matchesAnyExtension(probe: AgentDocumentProbeResult, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }

  const extensions = collectProbeExtensions(probe);
  return compactNormalizedExtensions(values).some((value) => extensions.has(value));
}

function matchesAnyMediaType(probe: AgentDocumentProbeResult, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }

  const mediaType = normalizeToken(probe.mediaType);
  return Boolean(mediaType && compactNormalizedTokens(values).includes(mediaType));
}

function matchesOptionalBoolean(actual: boolean | undefined, expected: boolean | undefined): boolean {
  return expected === undefined ? false : actual === expected;
}

function matchesAnyContainerFormat(probe: AgentDocumentProbeResult, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }

  const format = normalizeToken(probe.container?.format);
  return Boolean(format && compactNormalizedTokens(values).includes(format));
}

function compactNormalizedTokens(values: readonly (string | undefined)[]): string[] {
  return values.flatMap((value) => {
    const normalized = normalizeToken(value);
    return normalized ? [normalized] : [];
  });
}

function compactNormalizedExtensions(values: readonly (string | undefined)[]): string[] {
  return values.flatMap((value) => {
    const normalized = normalizeExtension(value);
    return normalized ? [normalized] : [];
  });
}
