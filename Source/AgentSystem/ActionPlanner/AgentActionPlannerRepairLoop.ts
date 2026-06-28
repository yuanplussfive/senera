import { throwIfAborted } from "../Core/AgentCancellation.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "./AgentActionPlannerFailure.js";

export interface AgentActionPlannerRepairInput {
  attempt: number;
  invalidOutput: string;
  issues: string[];
}

export async function runAgentActionPlannerRepairLoop<T>(options: {
  initialError: unknown;
  maxAttempts: number;
  signal?: AbortSignal;
  repair: (input: AgentActionPlannerRepairInput) => Promise<T>;
}): Promise<T> {
  let currentError = options.initialError;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    const failure = normalizePlanningFailure(currentError);
    if (!isRepairablePlanningFailure(failure.error)) {
      throw currentError;
    }

    try {
      return await options.repair({
        attempt,
        invalidOutput: stringifyIssueValue(failure.invalidOutput ?? failure.error),
        issues: issueMessages(failure.error),
      });
    } catch (error) {
      currentError = error;
    }
  }

  throw currentError;
}
