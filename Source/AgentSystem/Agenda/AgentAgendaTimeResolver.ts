import { Temporal } from "@js-temporal/polyfill";
import * as chrono from "chrono-node";
import { resolveAgentTimeZone } from "../Time/AgentTime.js";

const TimeComponents = [
  "year",
  "month",
  "day",
  "weekday",
  "hour",
  "minute",
  "second",
  "millisecond",
  "meridiem",
  "timezoneOffset",
] as const satisfies readonly chrono.Component[];

interface RankedTimeResult {
  readonly result: chrono.ParsedResult;
  readonly coverage: number;
  readonly certainComponents: number;
  readonly parserIndex: number;
}

export interface AgentAgendaTimeResolutionInput {
  readonly text: string;
  readonly referenceInstant: string;
  readonly timeZone: string;
}

/**
 * Resolves model-preserved natural-language time through locale parsers while
 * keeping the reference instant and IANA time zone host-owned.
 */
export class AgentAgendaTimeResolver {
  resolve(input: AgentAgendaTimeResolutionInput): string {
    const text = requireText(input.text, "Agenda time expression");
    const reference = Temporal.Instant.from(input.referenceInstant);
    const timeZone = resolveAgentTimeZone(input.timeZone);
    const parsers = [chrono.zh.casual, chrono.casual] as const;
    const ranked = parsers.flatMap((parser, parserIndex) =>
      parser
        .parse(text, { instant: new Date(reference.epochMilliseconds), timezone: timeZone }, { forwardDate: true })
        .map((result) => rankResult(result, text, parserIndex)),
    );
    ranked.sort(compareRankedResults);
    const selected = ranked[0]?.result;
    if (!selected) {
      throw new Error(`Agenda time expression could not be resolved: ${text}`);
    }
    return Temporal.Instant.from(selected.start.date().toISOString()).toString();
  }
}

function rankResult(result: chrono.ParsedResult, source: string, parserIndex: number): RankedTimeResult {
  const sourceLength = [...source.trim()].length;
  return {
    result,
    coverage: sourceLength === 0 ? 0 : [...result.text.trim()].length / sourceLength,
    certainComponents: TimeComponents.filter((component) => result.start.isCertain(component)).length,
    parserIndex,
  };
}

function compareRankedResults(left: RankedTimeResult, right: RankedTimeResult): number {
  return (
    right.coverage - left.coverage ||
    right.certainComponents - left.certainComponents ||
    left.result.index - right.result.index ||
    left.parserIndex - right.parserIndex
  );
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
