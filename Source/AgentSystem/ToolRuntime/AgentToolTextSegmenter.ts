import { createHash } from "node:crypto";
import type { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";

export interface AgentToolTextSegment {
  readonly text: string;
  readonly index: number;
  readonly tokens: number;
  readonly atoms: readonly string[];
  readonly terms: readonly string[];
  readonly isProtected: boolean;
  vector?: Float32Array;
}

/**
 * A bounded view over the source units. The projector must know how many
 * units were present before sampling; otherwise a large tail can disappear
 * without contributing to the omission contract.
 */
export interface AgentToolTextSegmentation {
  readonly segments: readonly AgentToolTextSegment[];
  readonly sourceUnits: number;
  readonly omittedUnits: number;
}

const sentenceSegmenter = new Intl.Segmenter("und", { granularity: "sentence" });

export function segmentAgentToolText(value: string): readonly string[] {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/u).flatMap((block) => {
    const trimmed = block.trim();
    if (!trimmed) return [];
    if (trimmed.includes("```")) return [trimmed];
    if (trimmed.split("\n").every(isAgentToolLogLine)) {
      return trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    const sentences = [...sentenceSegmenter.segment(trimmed)].map((entry) => entry.segment.trim()).filter(Boolean);
    return sentences.length > 0 ? sentences : [trimmed];
  });
}

export function createAgentToolTextSegments(
  value: string,
  estimator: AgentModelTokenEstimator,
  maximumUnits: number,
): readonly AgentToolTextSegment[] {
  return createAgentToolTextSegmentation(value, estimator, maximumUnits).segments;
}

/**
 * Builds the same ranked-text units from an upstream splitter while keeping
 * the original unit boundaries intact. External splitters are deliberately
 * treated as a segmentation stage only; importance and budget selection stay
 * in Senera's shared ranker.
 */
export function createAgentToolTextSegmentsFromUnits(
  units: readonly string[],
  estimator: AgentModelTokenEstimator,
): readonly AgentToolTextSegment[] {
  return units
    .map((text, index) => ({ text: text.trim(), index }))
    .filter(({ text }) => text.length > 0)
    .map(({ text, index }) => ({
      text,
      index,
      tokens: estimator.estimate(text).tokenCount,
      atoms: extractAgentToolProtectedAtoms(text),
      terms: extractAgentToolTextTerms(text),
      isProtected: isAgentToolTextProtected(text),
    }));
}

export function createAgentToolTextSegmentation(
  value: string,
  estimator: AgentModelTokenEstimator,
  maximumUnits: number,
): AgentToolTextSegmentation {
  const units = segmentAgentToolText(value);
  const boundedUnits = selectBoundedTextUnits(units, maximumUnits);
  const segments = boundedUnits.map(({ text, index }) => ({
    text,
    index,
    tokens: estimator.estimate(text).tokenCount,
    atoms: extractAgentToolProtectedAtoms(text),
    terms: extractAgentToolTextTerms(text),
    isProtected: isAgentToolTextProtected(text),
  }));
  return {
    segments,
    sourceUnits: units.length,
    omittedUnits: Math.max(0, units.length - segments.length),
  };
}

export function hasRepeatedAgentToolTextUnits(value: string): boolean {
  const units = segmentAgentToolText(value).map((unit) => normalizeAgentToolTextKey(unit));
  return new Set(units).size < units.length;
}

export function normalizeAgentToolTextKey(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase();
}

export function createAgentToolTextCacheKey(value: string, maximumUnits?: number): string {
  return createHash("sha256")
    .update(value)
    .update("\u0000")
    .update(String(maximumUnits ?? ""))
    .digest("hex");
}

function selectBoundedTextUnits(
  units: readonly string[],
  maximumUnits: number,
): readonly { text: string; index: number }[] {
  const limit = Number.isFinite(maximumUnits) ? Math.max(1, Math.floor(maximumUnits)) : 1;
  if (units.length <= limit) return units.map((text, index) => ({ text, index }));

  const selected = new Set<number>();
  const add = (index: number): void => {
    if (selected.size >= limit || index < 0 || index >= units.length) return;
    selected.add(index);
  };

  // The first and last units preserve the usual result framing. Units that
  // carry declared facts are selected before the evenly spaced background
  // sample, so a URI or error in a long tail is not silently discarded.
  add(0);
  add(units.length - 1);
  units
    .map((text, index) => ({ index, signal: protectedUnitSignal(text) }))
    .filter((entry) => entry.signal > 0)
    .sort((left, right) => right.signal - left.signal || left.index - right.index)
    .forEach((entry) => add(entry.index));

  const remaining = limit - selected.size;
  if (remaining > 0) {
    for (let slot = 1; slot <= remaining; slot += 1) {
      const index = Math.round((slot * (units.length - 1)) / (remaining + 1));
      if (!selected.has(index)) add(index);
      if (selected.size >= limit) break;
    }
  }
  for (let index = 0; selected.size < limit && index < units.length; index += 1) add(index);
  return [...selected]
    .sort((left, right) => left - right)
    .flatMap((index) => {
      const text = units[index];
      return text === undefined ? [] : [{ text, index }];
    });
}

function protectedUnitSignal(value: string): number {
  const atoms = extractAgentToolProtectedAtoms(value).length;
  return atoms + Number(isAgentToolTextProtected(value));
}

export function extractAgentToolTextTerms(value: string): readonly string[] {
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(terms.filter((term) => term.length > 1))];
}

export function extractAgentToolProtectedAtoms(value: string): readonly string[] {
  const patterns = [
    /senera:\/\/[^\s"'`<>]+/giu,
    /https?:\/\/[^\s"'`<>]+/giu,
    /(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>]+/gu,
    /\b(?:[A-Za-z0-9_.-]+[\\/])+(?:[A-Za-z0-9_.-]+)(?::\d+(?::\d+)?)?/gu,
    /\b(?:sha256|sha|hash|revision|rev|exit(?:\s+code)?|status|error|code|request[_ -]?id)\s*[:=]\s*[A-Za-z0-9._:/+-]+/giu,
    /\b\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?\b/gu,
    /\b(?:v?\d+(?:\.\d+){1,3}|\d+(?:\.\d+)?(?:ms|s|kb|mb|gb|%|x))\b/giu,
  ];
  const uriAtoms = (value.match(/(?:senera|https?):\/\/[^\s"'`<>]+/giu) ?? []).map(normalizeProtectedAtom);
  const atoms = patterns.flatMap((pattern) => value.match(pattern) ?? []).map(normalizeProtectedAtom);
  return [
    ...new Set(
      atoms.filter(
        (atom) =>
          atom.length > 0 &&
          !(/^[a-z][\w-]*:\/\//iu.test(atom) && !uriAtoms.includes(atom)) &&
          !uriAtoms.some((uri) => uri !== atom && uri.endsWith(atom)),
      ),
    ),
  ];
}

function normalizeProtectedAtom(value: string): string {
  return value.trim().replace(/[.,;!?]+$/u, "");
}

export function isAgentToolTextProtected(value: string): boolean {
  return value.includes("```") || extractAgentToolProtectedAtoms(value).length > 0 || isAgentToolLogLine(value);
}

export function isAgentToolLogLine(value: string): boolean {
  return /^\s*(?:\[[^\]]+\]|\d{4}-\d{2}-\d{2}[T ]|(?:GET|POST|PUT|PATCH|DELETE)\s|(?:ERROR|WARN|INFO)\b)/u.test(value);
}
