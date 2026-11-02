import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import type { AgentBackgroundLearningRequestStatus } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type { AgentMemOSSemanticMemoryType } from "./AgentMemOSSemanticTypes.js";

/** Defaults and limits shared by configuration, generation, commands and tests. */
export const AgentMemoryDiaryLimits = {
  inputTokens: 32_768,
  turnPreviewTokens: 128,
  monthlyPreviewTokens: 512,
  recentDays: 7,
} as const;

export const AgentMemoryDiaryConfigSchema = z
  .object({
    InputTokenBudget: z.number().int().positive().max(AgentMemoryDiaryLimits.inputTokens),
    TurnPreviewTokens: z.number().int().positive().max(AgentMemoryDiaryLimits.inputTokens),
    MonthlyPreviewTokens: z.number().int().positive().max(AgentMemoryDiaryLimits.monthlyPreviewTokens),
    RecentDays: z.number().int().positive(),
    TimeZone: z.string().refine((value) => {
      try {
        Temporal.Now.zonedDateTimeISO(value);
        return true;
      } catch {
        return false;
      }
    }, "A valid IANA time zone is required."),
  })
  .strict();

export type AgentMemoryDiaryConfig = z.infer<typeof AgentMemoryDiaryConfigSchema>;
export const AgentMemoryDiaryDefaults: AgentMemoryDiaryConfig = {
  InputTokenBudget: AgentMemoryDiaryLimits.inputTokens,
  TurnPreviewTokens: AgentMemoryDiaryLimits.turnPreviewTokens,
  MonthlyPreviewTokens: AgentMemoryDiaryLimits.monthlyPreviewTokens,
  RecentDays: AgentMemoryDiaryLimits.recentDays,
  TimeZone: DefaultAgentTimeZone,
};

export const AgentMemoryDiaryKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}(?:-\d{2})?$/u)
  .refine((value) => {
    try {
      return (
        (value.length === 7 ? Temporal.PlainYearMonth.from(value) : Temporal.PlainDate.from(value)).toString() === value
      );
    } catch {
      return false;
    }
  }, "Use a valid YYYY-MM or YYYY-MM-DD calendar date.");

/** Exactly two model fields; provenance and scheduling are owned by the host. */
export const AgentMemoryDiaryDocumentSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .regex(/^[^\r\n]+$/u)
      .describe("A concise, specific, single-line diary title, without Markdown heading syntax."),
    body: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The complete diary in Markdown. Use useful headings and evidence-grounded prose, without repeating the document title.",
      ),
  })
  .strict();
export type AgentMemoryDiaryDocument = z.infer<typeof AgentMemoryDiaryDocumentSchema>;

export interface AgentMemoryDiaryEntry {
  readonly key: string;
  readonly title: string;
  readonly path: string;
}

export type AgentMemoryDiaryLearningStatus = AgentBackgroundLearningRequestStatus | "pending" | "skipped";

export interface AgentMemoryDiaryMemory {
  readonly type: AgentMemOSSemanticMemoryType;
  readonly summary: string;
  readonly weight?: number;
}

/** One physical completed turn, with optional semantic learning attached. */
export interface AgentMemoryDiarySource {
  readonly id: string;
  readonly occurredAt: string;
  readonly subject?: string;
  readonly userText: string;
  readonly assistantText: string;
  readonly learning: AgentMemoryDiaryLearningStatus;
  readonly memories: readonly AgentMemoryDiaryMemory[];
  readonly episodeUris: readonly string[];
  readonly sourceUris: readonly string[];
}

export function agentMemoryDiaryDate(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function agentMemoryDiaryMonth(date: string): string {
  return Temporal.PlainDate.from(date).toPlainYearMonth().toString();
}
