import { describe, expect, test } from "vitest";
import {
  AgentInvalidModelToolArgumentsError,
  AgentRequiredModelToolCallError,
  formatAgentModelFailure,
  mapAgentModelFailure,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import {
  ModelProviderHttpError,
  ModelRequestTimeoutError,
} from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";
import { AgentBamlModelCallError } from "../../../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";
import { z } from "zod";

describe("model failure mapper", () => {
  test("classifies wrapped provider failures without relying on rendered messages", () => {
    const wrapped = new AgentBamlModelCallError({
      functionName: "ExtractContinuityFacts",
      attempts: [],
      issues: ["request failed"],
      error: new ModelProviderHttpError(400, "Bad Request", "invalid input"),
    });

    expect(mapAgentModelFailure(wrapped)).toEqual({ code: "http_error", status: 400 });
    expect(formatAgentModelFailure(mapAgentModelFailure(wrapped))).toBe("http_error:400");
  });

  test("classifies shared tool-result and timeout failures", () => {
    expect(mapAgentModelFailure(new AgentRequiredModelToolCallError("Commit", []))).toEqual({
      code: "tool_call_missing",
    });
    expect(mapAgentModelFailure(new AgentInvalidModelToolArgumentsError("Commit"))).toEqual({
      code: "invalid_tool_arguments",
    });
    expect(mapAgentModelFailure(new ModelRequestTimeoutError("max_request"))).toEqual({ code: "timeout" });
    let parseError: unknown;
    try {
      z.string().parse(42);
    } catch (error) {
      parseError = error;
    }
    expect(mapAgentModelFailure(parseError)).toEqual({ code: "structured_output_error" });
  });
});
