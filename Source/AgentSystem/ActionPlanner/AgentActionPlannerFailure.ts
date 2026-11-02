import { z } from "zod";
import { BamlValidationError } from "@boundaryml/baml";
import { AgentStructuredOutputValidationError } from "../Diagnostics/AgentStructuredOutputValidationError.js";
import {
  AgentBamlModelCallError,
  AgentBamlStructuredOutputError,
} from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { zodIssuesToAgentStructuredIssues, type AgentStructuredIssue } from "../Diagnostics/AgentStructuredIssue.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";

interface RawActionPlanningFailure {
  error: unknown;
  invalidOutput?: unknown;
}

export function issueMessages(error: unknown): string[] {
  if (error instanceof AgentStructuredOutputValidationError) {
    return error.issues;
  }

  if (error instanceof AgentBamlModelCallError || error instanceof AgentBamlStructuredOutputError) {
    return error.issues;
  }

  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "/"}: ${issue.message}`);
  }

  return [errorMessage(error)];
}

export function issueDetails(error: unknown): AgentStructuredIssue[] {
  if (error instanceof AgentStructuredOutputValidationError) {
    return error.issueDetails;
  }

  if (error instanceof AgentBamlStructuredOutputError) {
    return error.structuredIssues;
  }

  if (error instanceof z.ZodError) {
    return zodIssuesToAgentStructuredIssues(error.issues);
  }

  return [];
}

export function stringifyIssueValue(error: unknown): string {
  if (error instanceof AgentStructuredOutputValidationError) {
    return stringifyPromptValue(error.invalidOutput);
  }

  if (error instanceof AgentBamlModelCallError) {
    return stringifyIssueValue(error.originalError);
  }

  if (error instanceof AgentBamlStructuredOutputError) {
    return error.rawOutput ?? stringifyPromptValue(error.attempts);
  }

  if (error instanceof z.ZodError) {
    return stringifyPromptValue(error.issues);
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return stringifyPromptValue(error);
}

/**
 * Repair prompts are part of a model-call family. Keep structured invalid
 * output compact and key-order stable so equivalent failures reuse the same
 * provider prefix while preserving the complete value for the repair pass.
 */
function stringifyPromptValue(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "null" : stringifyAgentCanonicalJson(value);
}

export function normalizePlanningFailure(error: unknown): RawActionPlanningFailure {
  return error instanceof AgentStructuredOutputValidationError || error instanceof AgentBamlStructuredOutputError
    ? {
        error,
        invalidOutput: error instanceof AgentBamlStructuredOutputError ? error.rawOutput : error.invalidOutput,
      }
    : {
        error,
      };
}

export function isRepairablePlanningFailure(error: unknown): boolean {
  return (
    error instanceof AgentStructuredOutputValidationError ||
    error instanceof AgentBamlStructuredOutputError ||
    error instanceof z.ZodError ||
    error instanceof BamlValidationError
  );
}
