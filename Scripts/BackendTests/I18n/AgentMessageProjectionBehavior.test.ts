import { describe, expect, it } from "vitest";
import { AgentConfigStaleWriteError } from "../../../Source/AgentSystem/Config/AgentProviderModelConfigCommandTypes.js";
import { serializeError } from "../../../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLocalizedError } from "../../../Source/AgentSystem/I18n/AgentLocalizedError.js";
import {
  projectAgentErrorMessage,
  projectAgentMessage,
} from "../../../Source/AgentSystem/I18n/AgentMessageProjection.js";
import { projectAgentWebSocketRequestFailure } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestFailures.js";

describe("agent localized message projection", () => {
  it("projects every supported locale from one key and parameter set", () => {
    expect(projectAgentMessage("config.providerEndpointMissing", { providerId: "custom" })).toEqual({
      message: "供应商端点配置不存在：ProviderId=custom",
      localizedMessage: {
        key: "config.providerEndpointMissing",
        params: { providerId: "custom" },
        text: {
          "zh-CN": "供应商端点配置不存在：ProviderId=custom",
          "en-US": "The provider endpoint does not exist: ProviderId=custom",
        },
      },
    });
  });

  it("preserves descriptors through custom errors and diagnostic serialization", () => {
    const error = new AgentLocalizedError("model.listBaseUrlEmpty", { providerId: "custom" });

    expect(projectAgentErrorMessage(error, "model.listFailed").localizedMessage.text["en-US"]).toBe(
      "The provider base URL is empty: custom",
    );
    expect(serializeError(error)).toMatchObject({
      name: "AgentLocalizedError",
      messageKey: "model.listBaseUrlEmpty",
      messageParams: { providerId: "custom" },
    });
  });

  it("uses an event-specific localized fallback for unknown errors", () => {
    const projected = projectAgentErrorMessage(new Error("opaque transport failure"), "config.operationFailed");

    expect(projected.message).toBe("opaque transport failure");
    expect(projected.localizedMessage.text).toEqual({
      "zh-CN": "配置操作失败。",
      "en-US": "The configuration operation failed.",
    });
  });

  it("projects stale provider writes into a bilingual WebSocket failure", () => {
    const event = projectAgentWebSocketRequestFailure(
      {
        type: "provider.endpoint.upsert",
        commandId: "command-1",
        endpoint: { Id: "custom" },
      },
      new AgentConfigStaleWriteError({
        baseRevision: 4,
        currentRevision: 5,
        baseVersion: 8,
        currentVersion: 9,
      }),
    );

    expect(event).toMatchObject({
      kind: "config.failed",
      data: {
        localizedMessage: {
          key: "config.staleWriteRevision",
          params: { baseRevision: 4, currentRevision: 5 },
          text: {
            "en-US":
              "The configuration was updated by another operation. Refresh and try again. baseRevision=4 currentRevision=5",
          },
        },
      },
    });
  });
});
