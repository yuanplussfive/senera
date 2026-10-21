import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import {
  AgentToolResourceQueryShapes,
  type AgentToolResourceQueryShape,
} from "../ToolRuntime/AgentToolResourceDiscovery.js";

export const AgentToolSearchQueryShapeKinds = AgentToolResourceQueryShapes;

export type AgentToolSearchQueryShapeKind = AgentToolResourceQueryShape;

/**
 * Describes syntax the user supplied, without classifying the request by a
 * vocabulary of tool names. These shapes are derived from the query and the
 * declared tool contract, so extensions participate without adapter code.
 */
export function queryShapes(query: string, tokenizer: AgentToolSearchTokenizer): AgentToolSearchQueryShapeKind[] {
  const normalized = query.normalize("NFKC");
  const withoutUrls = stripUrlLiterals(normalized);
  return [
    ...(containsUrlLiteral(normalized) ? [AgentToolSearchQueryShapeKinds.Url] : []),
    ...(PathLikeTextPattern.test(withoutUrls) || tokenizer.tokenizeContent(withoutUrls).some(isPathLikeToken)
      ? [AgentToolSearchQueryShapeKinds.Path]
      : []),
  ];
}

/**
 * Removes resource literals from the language query while preserving the
 * surrounding action words. URLs and workspace paths are input values, not
 * evidence that a request is about their host names, path segments, or file
 * extensions. The original query remains available to structural routing and
 * tool execution.
 */
export function projectToolSearchRetrievalQuery(query: string): string {
  return stripPathLiterals(stripUrlLiterals(query.normalize("NFKC")))
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function isPathLikeToken(token: string): boolean {
  return /^(?:[a-z]:[\\/]|[./\\]|[\p{L}\p{N}_-]+\.[\p{L}_][\p{L}\p{N}_-]{0,15})$/u.test(token);
}

/**
 * Tokenizers intentionally discard punctuation, but punctuation carries the
 * strongest signal for a file reference (for example `package.json`). Keep a
 * small syntax detector over the original query so retrieval can use the
 * resource declarations without depending on a particular tokenizer.
 */
const PathLikeTextPattern =
  /(?:^|[\s"'`([{,;:!?])(?:[a-z]:[\\/]|\.{0,2}[\\/][^\s"'`)}\],;:!?]+|[\p{L}\p{N}_-]+(?:[\\/][\p{L}\p{N}_.-]+)+|[\p{L}\p{N}_-]+\.[\p{L}_][\p{L}\p{N}_-]{0,15})(?=$|[\s"'`)}\],;:!?])/iu;

const UrlLiteralPattern = /\bhttps?:\/\/[^\s<>"'`]+/giu;
const PathLiteralPattern =
  /(^|[\s"'`([{,;:!?])(?:[a-z]:[\\/][^\s"'`)}\],;:!?]*|\.{0,2}[\\/][^\s"'`)}\],;:!?]+|[\p{L}\p{N}_-]+(?:[\\/][\p{L}\p{N}_.-]+)+|[\p{L}\p{N}_-]+\.[\p{L}_][\p{L}\p{N}_-]{0,15})(?=$|[\s"'`)}\],;:!?])/giu;

function containsUrlLiteral(text: string): boolean {
  return [...text.matchAll(UrlLiteralPattern)].length > 0;
}

function stripUrlLiterals(text: string): string {
  return text.replace(UrlLiteralPattern, " ");
}

function stripPathLiterals(text: string): string {
  return text.replace(PathLiteralPattern, (_match, prefix: string) => `${prefix} `);
}
