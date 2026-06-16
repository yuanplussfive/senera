import { z } from "zod";
import {
  BamlAbortError,
  BamlTimeoutError,
} from "@boundaryml/baml";
import {
  BamlClientFinishReasonError,
  BamlClientHttpError,
  BamlValidationError,
} from "./BamlClient/baml_client/index.js";
import { AgentActionPlannerValidationError } from "./AgentActionPlannerSchema.js";

export interface RawActionPlanningFailure {
  error: unknown;
  invalidOutput?: unknown;
}

export function issueMessages(error: unknown): string[] {
  if (error instanceof AgentActionPlannerValidationError) {
    return error.issues;
  }

  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "/"}: ${issue.message}`);
  }

  return [error instanceof Error ? error.message : String(error)];
}

export function stringifyIssueValue(error: unknown): string {
  if (error instanceof AgentActionPlannerValidationError) {
    return JSON.stringify(error.invalidDecision, null, 2);
  }

  if (error instanceof z.ZodError) {
    return JSON.stringify(error.issues, null, 2);
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return JSON.stringify(error);
}

export function normalizePlanningFailure(error: unknown): RawActionPlanningFailure {
  return error instanceof AgentActionPlannerValidationError
    ? {
        error,
        invalidOutput: error.invalidDecision,
      }
    : {
        error,
      };
}

export function isRepairablePlanningFailure(error: unknown): boolean {
  return error instanceof AgentActionPlannerValidationError
    || error instanceof z.ZodError
    || error instanceof BamlValidationError;
}

export function summarizePlannerFailure(error: unknown): string {
  if (error instanceof BamlTimeoutError) {
    return "action_planner_timeout";
  }

  if (error instanceof BamlClientHttpError) {
    return `action_planner_http_error${error.status_code > 0 ? `:${error.status_code}` : ""}`;
  }

  if (error instanceof BamlAbortError) {
    return "action_planner_aborted";
  }

  if (error instanceof BamlClientFinishReasonError) {
    return "action_planner_incomplete_output";
  }

  if (error instanceof BamlValidationError) {
    return "action_planner_invalid_structured_output";
  }

  if (error instanceof AgentActionPlannerValidationError || error instanceof z.ZodError) {
    return "action_planner_invalid_decision";
  }

  return error instanceof Error ? truncateOneLine(error.message, 160) : truncateOneLine(String(error), 160);
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = collapseWhitespace(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function collapseWhitespace(value: string): string {
  const pieces: string[] = [];
  let lastWasWhitespace = true;
  for (const char of value) {
    if (char.trim().length === 0) {
      if (!lastWasWhitespace) {
        pieces.push(" ");
      }
      lastWasWhitespace = true;
      continue;
    }
    pieces.push(char);
    lastWasWhitespace = false;
  }
  if (pieces[pieces.length - 1] === " ") {
    pieces.pop();
  }
  return pieces.join("");
}
