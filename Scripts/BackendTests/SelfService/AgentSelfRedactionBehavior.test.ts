import { describe, expect, test } from "vitest";
import {
  AgentSelfRedactedMarker,
  isAgentSelfSensitiveKey,
  projectAgentSelfRedacted,
} from "../../../Source/AgentSystem/SelfService/AgentSelfRedaction.js";

describe("self-service redaction", () => {
  test("uses the shared secret field contract for nested values", () => {
    const projected = projectAgentSelfRedacted({
      ApiKey: "api-secret",
      AppSecret: "app-secret",
      nested: { refresh_token: "refresh-secret", visible: "keep" },
    }) as Record<string, unknown>;

    expect(projected.ApiKey).toBe(AgentSelfRedactedMarker);
    expect(projected.AppSecret).toBe(AgentSelfRedactedMarker);
    expect(projected.nested).toEqual({ refresh_token: AgentSelfRedactedMarker, visible: "keep" });
  });

  test("redacts structured secret values without exposing fragments", () => {
    const projected = projectAgentSelfRedacted({
      envelope: "senera:secret:v1:abcdef123456",
      authorization: "Bearer live-token",
    }) as Record<string, unknown>;

    expect(projected.envelope).toBe(AgentSelfRedactedMarker);
    expect(projected.authorization).toBe(AgentSelfRedactedMarker);
    expect(JSON.stringify(projected)).not.toContain("abcdef123456");
    expect(JSON.stringify(projected)).not.toContain("live-token");
  });

  test("keeps public QQ endpoints and unrelated text visible", () => {
    const projected = projectAgentSelfRedacted({
      tokenApiBase: "https://bots.qq.com",
      note: "the host bots.qq.com is public documentation",
    });

    expect(projected).toEqual({
      tokenApiBase: "https://bots.qq.com",
      note: "the host bots.qq.com is public documentation",
    });
  });

  test("does not classify ordinary keys as secrets", () => {
    expect(isAgentSelfSensitiveKey("monkey")).toBe(false);
    expect(isAgentSelfSensitiveKey("displayName")).toBe(false);
    expect(isAgentSelfSensitiveKey("private_key")).toBe(true);
    expect(isAgentSelfSensitiveKey("Authorization")).toBe(true);
  });
});
