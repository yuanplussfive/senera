import type { MemoryNode, MemoryType } from "@mem-os/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";
import { z } from "zod";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";

export const AgentMemOSTags = {
  semantic: "semantic-memory",
  knowledge: "knowledge",
  fragment: "turn-fragment",
  dailyDigest: "daily-digest",
  monthlyDigest: "monthly-digest",
  toolRouting: "tool-routing",
  stateCard: "state-card",
  dayPrefix: "day:",
  monthPrefix: "month:",
  writePrefix: "write:",
} as const;

export function agentMemOSDayTag(localDate: string): string {
  return `${AgentMemOSTags.dayPrefix}${Temporal.PlainDate.from(localDate).toString()}`;
}

export function agentMemOSMonthTag(localMonth: string): string {
  return `${AgentMemOSTags.monthPrefix}${Temporal.PlainYearMonth.from(localMonth).toString()}`;
}

export function agentMemOSLocalMonth(localDate: string): string {
  return Temporal.PlainDate.from(localDate).toPlainYearMonth().toString();
}

/** Internal tag encoding is decoded in one place; it does not classify memory content. */
function readTagValue(tags: readonly string[], prefix: string): string {
  const values = [...new Set(tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length)))];
  if (values.length !== 1 || !values[0]) throw new Error(`MemOS requires exactly one ${prefix} tag.`);
  return values[0];
}

export function readAgentMemOSDay(tags: readonly string[]): string {
  return Temporal.PlainDate.from(readTagValue(tags, AgentMemOSTags.dayPrefix)).toString();
}

export function readAgentMemOSMonth(tags: readonly string[]): string {
  return Temporal.PlainYearMonth.from(readTagValue(tags, AgentMemOSTags.monthPrefix)).toString();
}

export function replaceAgentMemOSWriteTag(tags: readonly string[], writeTag: string): string[] {
  return [...tags.filter((tag) => !tag.startsWith(AgentMemOSTags.writePrefix)), writeTag];
}

export const AgentMemOSSummarySchema = z.string().trim().min(1);

export function projectAgentMemOSPeriod(tags: readonly string[]):
  | {
      readonly granularity: "day" | "month";
      readonly start: string;
      readonly end: string;
    }
  | undefined {
  const daily = tags.includes(AgentMemOSTags.dailyDigest);
  const monthly = tags.includes(AgentMemOSTags.monthlyDigest);
  if (!daily && !monthly) return undefined;
  if (daily && monthly) throw new Error("MemOS digest cannot be both daily and monthly.");
  const date = daily
    ? Temporal.PlainDate.from(readAgentMemOSDay(tags))
    : Temporal.PlainYearMonth.from(readAgentMemOSMonth(tags)).toPlainDate({ day: 1 });
  const start = date.toZonedDateTime(DefaultAgentTimeZone).startOfDay();
  const end = daily ? start.add({ days: 1 }) : start.add({ months: 1 });
  return { granularity: daily ? "day" : "month", start: start.toInstant().toString(), end: end.toInstant().toString() };
}

export function projectAgentMemOSOccurredAt(node: MemoryNode): string {
  const period = projectAgentMemOSPeriod(node.tags);
  if (period) return period.start;
  return Temporal.Instant.fromEpochMilliseconds(node.validFrom ?? node.createdAt).toString();
}

export function agentMemOSRevision(node: MemoryNode): string {
  return sha256HexOfCanonicalJson({
    content: node.content,
    summary: node.summary,
    type: node.type,
    validFrom: node.validFrom,
    validTo: node.validTo,
    period: projectAgentMemOSPeriod(node.tags),
  });
}

export function agentMemOSDeliveryKey(node: MemoryNode): string {
  return `${agentMemOSReference(node.id)}@${agentMemOSRevision(node)}`;
}

export function agentMemOSWriteTag(key: string): string {
  return `${AgentMemOSTags.writePrefix}${sha256HexOfCanonicalJson(key)}`;
}

/** MemOS' native type vocabulary. Senera does not remap or narrow it. */
export const AgentMemOSSemanticMemoryTypes = [
  "fact",
  "preference",
  "relationship",
  "context",
  "entity",
  "custom",
] as const;
export type AgentMemOSSemanticMemoryType = MemoryType;

export interface AgentMemOSSemanticFragment {
  readonly topic: string;
  readonly summary: string;
  readonly type: AgentMemOSSemanticMemoryType;
  readonly action: AgentMemOSSemanticFragmentAction;
  readonly candidate?: number;
}

export const AgentMemOSSemanticFragmentActions = ["new", "update", "supersede"] as const;
export type AgentMemOSSemanticFragmentAction = (typeof AgentMemOSSemanticFragmentActions)[number];

export interface AgentMemOSSemanticCandidate {
  readonly ref: number;
  readonly summary: string;
  readonly type: AgentMemOSSemanticMemoryType;
}

export interface AgentMemOSFragmentHistoryEntry {
  readonly user: string;
  readonly assistant: string;
  readonly stateCard?: AgentStateCard;
}

export interface AgentMemOSFragmentPromptInput {
  readonly user: string;
  readonly assistant: string;
  readonly stateCard?: AgentStateCard;
  readonly history: readonly AgentMemOSFragmentHistoryEntry[];
  readonly candidates: readonly AgentMemOSSemanticCandidate[];
  readonly memoryIntents: readonly string[];
}

export interface AgentMemOSDigestEntry {
  readonly summary: string;
  /** MemOS owns this value; preserve its native type without a Senera allow-list. */
  readonly type: string;
  readonly occurredAt: string;
}

export interface AgentMemOSDigestPromptInput {
  readonly period: "day" | "month";
  readonly periodKey: string;
  readonly entries: readonly AgentMemOSDigestEntry[];
}
