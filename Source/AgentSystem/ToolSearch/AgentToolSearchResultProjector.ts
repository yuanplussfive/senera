import { AgentToolDiscoveryProtocol } from "./AgentToolMetaToolProtocol.js";
import type { AgentToolSearchDiscovery, AgentToolSearchResult, AgentToolSearchSource } from "./AgentToolSearchTypes.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentToolAvailability } from "../ToolRuntime/AgentToolAvailability.js";

/**
 * Tool discovery is intentionally a compact wire contract. Full descriptions,
 * argument schemas, effects, and provenance remain the responsibility of
 * ToolDescribe, so broad retrieval never repeats nested JSON contracts.
 *
 * match: [toolName, description, state?]
 * maybe: [toolName, description]
 * more:  [sourceId, sourceName, omittedToolCount]
 */
export interface AgentToolSearchResultProjection {
  readonly availability?: Readonly<Record<string, AgentToolAvailability>>;
  readonly services?: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly availability: AgentToolAvailability;
  }[];
  readonly status?: "empty" | "stale";
  readonly reason?: string;
  readonly diagnostics?: readonly string[];
  readonly catalogRevision?: string;
  readonly match?: readonly AgentToolSearchMatchTuple[];
  readonly maybe?: readonly AgentToolSearchNameTuple[];
  readonly more?: readonly AgentToolSearchSourceTuple[];
}

export interface AgentToolSearchResultProjectionOptions {
  /** The active chat model selects the same BPE accounting used elsewhere in the runtime. */
  readonly model: string;
  /** Maximum BPE tokens for uncertain candidates; matches and selected service availability are retained. */
  readonly tokenBudget: number;
}

export type AgentToolSearchNameTuple = readonly [toolName: string, description: string];

export type AgentToolSearchStateTuple = readonly [
  exposure: "visible" | "discoverable",
  contract: "confirmed" | "unconfirmed",
  reuse: "arguments" | "none",
  reusableArguments?: Record<string, unknown>,
];

export type AgentToolSearchMatchTuple = readonly [
  toolName: string,
  description: string,
  state?: AgentToolSearchStateTuple,
];

export type AgentToolSearchSourceTuple = readonly [sourceId: string, sourceName: string, count: number];

/**
 * Projects all high-confidence matches, then jointly budgets uncertain names
 * and the source summaries for candidates that stay folded. A greedy
 * description-only projection can consume the entire budget before it ever
 * reports `more`; planning both representations together keeps the model
 * aware of remaining capability domains. There is no candidate-count cutoff.
 */
export function buildToolSearchResultProjection(
  discovery: AgentToolSearchDiscovery,
  options: AgentToolSearchResultProjectionOptions,
): AgentToolSearchResultProjection {
  const tokenBudget = validateTokenBudget(options.tokenBudget);
  const estimator = new AgentModelTokenEstimator({ model: options.model });
  const match = discovery.match.map(projectMatch);
  const { maybe, more } = projectUncertainCandidates({
    discovery,
    estimator,
    tokenBudget,
  });

  return projectWire(discovery, match, maybe, more);
}

/** Only `match` candidates can feed capability reuse and routing scenarios. */
export function readToolNamesFromSearchResult(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.match)) return [];
  return result.match.flatMap((entry) => {
    const name = Array.isArray(entry) ? entry[0] : undefined;
    return typeof name === "string" && name.trim().length > 0 ? [name] : [];
  });
}

function projectMatch(result: AgentToolSearchResult): AgentToolSearchMatchTuple {
  const state = projectState(result);
  return state ? [result.toolName, result.summary, state] : [result.toolName, result.summary];
}

function projectName(result: AgentToolSearchResult): AgentToolSearchNameTuple {
  return [result.toolName, result.summary];
}

function projectState(result: AgentToolSearchResult): AgentToolSearchStateTuple | undefined {
  const state = result.state;
  if (!state) return undefined;
  const isDefault = state.exposure === "discoverable" && state.contract === "unconfirmed" && state.reuse === "none";
  if (isDefault) return undefined;
  return state.reuse === "arguments" && state.reusableArguments
    ? [state.exposure, state.contract, state.reuse, state.reusableArguments]
    : [state.exposure, state.contract, state.reuse];
}

function projectWire(
  discovery: AgentToolSearchDiscovery,
  match: readonly AgentToolSearchMatchTuple[],
  maybe: readonly AgentToolSearchNameTuple[],
  more: readonly AgentToolSearchSourceTuple[],
): AgentToolSearchResultProjection {
  const shownNames = new Set([...match, ...maybe].map(([name]) => name));
  const availability = Object.fromEntries(
    [...discovery.match, ...discovery.maybe]
      .filter(
        (result) => shownNames.has(result.toolName) && result.availability && result.availability.status !== "ready",
      )
      .map((result) => [result.toolName, result.availability!]),
  );
  const services = discovery.services
    ?.filter((service) => service.availability.status !== "ready")
    .map(({ id, title, description, availability: state }) => ({ id, title, description, availability: state }));
  return {
    ...(Object.keys(availability).length > 0 ? { availability } : {}),
    ...(services?.length ? { services } : {}),
    ...(discovery.status ? { status: discovery.status } : {}),
    ...(discovery.reason ? { reason: discovery.reason } : {}),
    ...(discovery.diagnostics && discovery.diagnostics.length > 0 ? { diagnostics: discovery.diagnostics } : {}),
    ...(discovery.catalogRevision ? { catalogRevision: discovery.catalogRevision } : {}),
    ...(match.length > 0 ? { match } : {}),
    ...(maybe.length > 0 ? { maybe } : {}),
    ...(more.length > 0 ? { more } : {}),
  };
}

interface UncertainCandidateProjectionOptions {
  readonly discovery: AgentToolSearchDiscovery;
  readonly estimator: AgentModelTokenEstimator;
  readonly tokenBudget: number;
}

/**
 * Every tentative candidate is considered in the confidence planner's order.
 * Its admission is evaluated alongside a fresh source roll-up of everything
 * still folded, so `more` is not accidentally starved by verbose summaries.
 * The roll-up is derived from actual withheld candidates and naturally shrinks
 * as individual tools are named.
 */
function projectUncertainCandidates(options: UncertainCandidateProjectionOptions): ProjectedUncertainCandidates {
  const maybe: AgentToolSearchNameTuple[] = [];
  const withheld = [...options.discovery.omitted];
  const candidates = options.discovery.maybe;

  for (const [index, result] of candidates.entries()) {
    const candidate = projectName(result);
    const remaining = [...withheld, ...candidates.slice(index + 1)];
    const currentMore = projectFittingWithheldSources({
      discovery: options.discovery,
      results: remaining,
      maybe,
      estimator: options.estimator,
      tokenBudget: options.tokenBudget,
    });
    const proposedMaybe = [...maybe, candidate];
    const proposedMore = projectFittingWithheldSources({
      discovery: options.discovery,
      results: remaining,
      maybe: proposedMaybe,
      estimator: options.estimator,
      tokenBudget: options.tokenBudget,
    });
    const preservesSourceDisclosure = currentMore.length === 0 || proposedMore.length > 0;
    if (
      preservesSourceDisclosure &&
      fitsBudget(options.estimator, options.tokenBudget, options.discovery, proposedMaybe, proposedMore)
    ) {
      maybe.push(candidate);
    } else {
      withheld.push(result);
    }
  }

  return {
    maybe,
    more:
      withheld.length > 0
        ? projectFittingWithheldSources({
            discovery: options.discovery,
            results: withheld,
            maybe,
            estimator: options.estimator,
            tokenBudget: options.tokenBudget,
          })
        : [],
  };
}

interface ProjectedUncertainCandidates {
  readonly maybe: readonly AgentToolSearchNameTuple[];
  readonly more: readonly AgentToolSearchSourceTuple[];
}

interface WithheldSourceProjectionOptions {
  readonly discovery: AgentToolSearchDiscovery;
  readonly results: readonly AgentToolSearchResult[];
  readonly maybe: readonly AgentToolSearchNameTuple[];
  readonly estimator: AgentModelTokenEstimator;
  readonly tokenBudget: number;
}

function projectFittingWithheldSources(options: WithheldSourceProjectionOptions): AgentToolSearchSourceTuple[] {
  const more: AgentToolSearchSourceTuple[] = [];
  for (const source of projectWithheldSources(options.results)) {
    const proposed = [...more, source];
    if (fitsBudget(options.estimator, options.tokenBudget, options.discovery, options.maybe, proposed)) {
      more.push(source);
    }
  }
  return more;
}

function fitsBudget(
  estimator: AgentModelTokenEstimator,
  tokenBudget: number,
  discovery: AgentToolSearchDiscovery,
  maybe: readonly AgentToolSearchNameTuple[],
  more: readonly AgentToolSearchSourceTuple[],
): boolean {
  // Matches and selected service availability are evidence tiers exempt from the
  // uncertain disclosure budget. Otherwise one verbose producer summary could
  // suppress every `maybe`/`more` signal and hide the catalog frontier.
  const wire = projectWire({ ...discovery, services: undefined }, [], maybe, more);
  const payload = { type: AgentToolDiscoveryProtocol.type, ...wire };
  return estimator.inspect(JSON.stringify(payload), tokenBudget).withinLimit;
}

function projectWithheldSources(results: readonly AgentToolSearchResult[]): AgentToolSearchSourceTuple[] {
  const sources = new Map<string, { source: AgentToolSearchSource; toolNames: Set<string>; firstRank: number }>();
  results.forEach((result, rank) => {
    if (result.sources.length === 0) {
      throw new Error(`Tool search result ${result.toolName} is missing effective discovery source metadata.`);
    }
    result.sources.forEach((source) => {
      const current = sources.get(source.id);
      if (current) {
        if (current.source.title !== source.title || current.source.description !== source.description) {
          throw new Error(`Tool discovery source ${source.id} has conflicting metadata.`);
        }
        current.toolNames.add(result.toolName);
      } else {
        sources.set(source.id, {
          source,
          toolNames: new Set([result.toolName]),
          firstRank: rank,
        });
      }
    });
  });
  return [...sources.values()]
    .sort(
      (left, right) =>
        right.toolNames.size - left.toolNames.size ||
        left.firstRank - right.firstRank ||
        left.source.id.localeCompare(right.source.id),
    )
    .map(({ source, toolNames }) => [source.id, source.title, toolNames.size]);
}

function validateTokenBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("ToolSearch disclosure TokenBudget must be a positive safe integer.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
