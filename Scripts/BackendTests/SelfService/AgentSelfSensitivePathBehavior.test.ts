import { describe, expect, test } from "vitest";
import {
  AgentSelfConfigPathLevels,
  resolveAgentSelfConfigPathRule,
  validateAgentSelfConfigPathValue,
} from "../../../Source/AgentSystem/SelfService/AgentSelfSensitivePath.js";

describe("senera sensitive config path rules", () => {
  test("resolves human rules for exposure-surface paths", () => {
    expect(resolveAgentSelfConfigPathRule("Server.AccessControl.Mode")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
      pattern: "Server.AccessControl.*",
    });
    expect(resolveAgentSelfConfigPathRule("Server.AccessControl.RequireAuthorization")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
    });
    expect(resolveAgentSelfConfigPathRule("Server.Host")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
      pattern: "Server.Host",
    });
    expect(resolveAgentSelfConfigPathRule("Server.Port")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
    });
    expect(resolveAgentSelfConfigPathRule("ModelProviderEndpoints.0.BaseUrl")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
    });
    expect(resolveAgentSelfConfigPathRule("ModelProviders.0.ApiKey")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
    });
    expect(resolveAgentSelfConfigPathRule("DefaultModelProviderId")).toMatchObject({
      level: AgentSelfConfigPathLevels.Human,
    });
  });

  test("resolves the most specific rule when a guard refines a human rule", () => {
    const rule = resolveAgentSelfConfigPathRule("ModelProviders.0.Temperature");
    expect(rule).toMatchObject({
      level: AgentSelfConfigPathLevels.Guard,
      pattern: "ModelProviders.*.Temperature",
    });
    expect(resolveAgentSelfConfigPathRule("ModelProviders.0.TopP")).toMatchObject({
      level: AgentSelfConfigPathLevels.Guard,
    });
  });

  test("does not match unrelated or bare paths", () => {
    expect(resolveAgentSelfConfigPathRule("Server.HotReload")).toBeUndefined();
    expect(resolveAgentSelfConfigPathRule("ModelProviders")).toBeUndefined();
    expect(resolveAgentSelfConfigPathRule("Server.AccessControl")).toBeUndefined();
    expect(resolveAgentSelfConfigPathRule("")).toBeUndefined();
    expect(resolveAgentSelfConfigPathRule("   ")).toBeUndefined();
  });

  test("guard rules validate values deterministically", () => {
    const temperature = resolveAgentSelfConfigPathRule("ModelProviders.0.Temperature")!;
    expect(validateAgentSelfConfigPathValue(temperature, 0.7)).toEqual({ valid: true });
    expect(validateAgentSelfConfigPathValue(temperature, 0)).toEqual({ valid: true });
    expect(validateAgentSelfConfigPathValue(temperature, 2)).toEqual({ valid: true });
    expect(validateAgentSelfConfigPathValue(temperature, 3)).toMatchObject({ valid: false });
    expect(validateAgentSelfConfigPathValue(temperature, "hot")).toMatchObject({ valid: false });

    const topP = resolveAgentSelfConfigPathRule("ModelProviders.0.TopP")!;
    expect(validateAgentSelfConfigPathValue(topP, 1)).toEqual({ valid: true });
    expect(validateAgentSelfConfigPathValue(topP, 1.5)).toMatchObject({ valid: false });
  });

  test("rules without a validator always pass the guard stage", () => {
    const host = resolveAgentSelfConfigPathRule("Server.Host")!;
    expect(host.level).toBe(AgentSelfConfigPathLevels.Human);
    expect(validateAgentSelfConfigPathValue(host, "0.0.0.0")).toEqual({ valid: true });
  });
});
