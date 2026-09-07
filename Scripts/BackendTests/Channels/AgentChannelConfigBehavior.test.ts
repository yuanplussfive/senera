import { describe, expect, test } from "vitest";
import { resolveAgentChannelsConfig } from "../../../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { createDefaultAgentChannelRegistry } from "../../../Source/AgentSystem/Channels/AgentChannelAdapterRegistry.js";
import { AgentQqChannelAdapter } from "../../../Source/AgentSystem/Channels/Adapters/AgentQqChannelAdapter.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

function configWithChannelsExtension(configuration: unknown): AgentSystemConfig {
  return {
    Extensions: { "agent-channels": { Enabled: true, Configuration: configuration } },
  } as unknown as AgentSystemConfig;
}

describe("channel config resolution", () => {
  test("master switch defaults to on so per-channel flags gate each adapter", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({ qq: { appId: "app", appSecret: "secret", enabled: true } }),
    );
    expect(resolved.enabled).toBe(true);
    expect(resolved.channels.qq.enabled).toBe(true);
    expect(resolved.channels.telegram.enabled).toBe(false);
  });

  test("an explicit master switch false disables the subsystem", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({ enabled: false, qq: { appId: "app", appSecret: "secret", enabled: true } }),
    );
    expect(resolved.enabled).toBe(false);
    expect(resolved.channels.qq.enabled).toBe(true);
  });

  test("absent extension section keeps the subsystem disabled", () => {
    const resolved = resolveAgentChannelsConfig({} as unknown as AgentSystemConfig);
    expect(resolved.enabled).toBe(false);
    expect(resolved.channels.qq.enabled).toBe(false);
  });

  test("QQ allowAllUsers defaults to on while other channels remain closed", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({ qq: { enabled: true, appId: "app", appSecret: "secret" } }),
    );
    expect(resolved.channels.qq.allowAllUsers).toBe(true);
    expect(resolved.channels.telegram.allowAllUsers).toBe(false);
    expect(resolved.channels.discord.allowAllUsers).toBe(false);
  });

  test("an explicit allowAllUsers false opts a channel into the closed allowlist", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({ qq: { enabled: true, appId: "app", appSecret: "secret", allowAllUsers: false } }),
    );
    expect(resolved.channels.qq.allowAllUsers).toBe(false);
  });

  test("keeps QQ resilience and STT settings typed instead of routing them through unknown fields", () => {
    const stt = { provider: "openai", apiKey: "stt-key", model: "whisper-1" };
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({
        qq: {
          enabled: true,
          quickDisconnectThresholdMs: 7_000,
          maxQuickDisconnects: 4,
          stt,
        },
      }),
    );
    expect(resolved.channels.qq.quickDisconnectThresholdMs).toBe(7_000);
    expect(resolved.channels.qq.maxQuickDisconnects).toBe(4);
    expect(resolved.channels.qq.stt).toEqual(stt);
    expect(resolved.channels.qq.unknown).toBeUndefined();
  });
});

describe("busy message routing resolution", () => {
  test("defaults to steering when no routing is configured", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({ qq: { enabled: true, appId: "app", appSecret: "secret" } }),
    );
    expect(resolved.channels.qq.busyMessageMode).toBe("steer");
    expect(resolved.channels.telegram.busyMessageMode).toBe("steer");
    expect(resolved.channels.discord.busyMessageMode).toBe("steer");
    expect(resolved.channels.qq.unknown).toBeUndefined();
  });

  test("a subsystem-level mode applies to every channel without its own value", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({
        busyMessageMode: "follow_up",
        qq: { enabled: true, appId: "app", appSecret: "secret" },
        telegram: { enabled: true, token: "tok" },
      }),
    );
    expect(resolved.channels.qq.busyMessageMode).toBe("follow_up");
    expect(resolved.channels.telegram.busyMessageMode).toBe("follow_up");
  });

  test("a per-channel override wins over the subsystem-level mode", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({
        busyMessageMode: "follow_up",
        qq: { enabled: true, appId: "app", appSecret: "secret", busyMessageMode: "steer" },
      }),
    );
    expect(resolved.channels.qq.busyMessageMode).toBe("steer");
    expect(resolved.channels.telegram.busyMessageMode).toBe("follow_up");
  });

  test("snake_case aliases and invalid values fall back safely", () => {
    const resolved = resolveAgentChannelsConfig(
      configWithChannelsExtension({
        qq: { enabled: true, appId: "app", appSecret: "secret", busy_message_mode: "follow_up" },
        telegram: { enabled: true, token: "tok", busyMessageMode: "whenever" },
      }),
    );
    expect(resolved.channels.qq.busyMessageMode).toBe("follow_up");
    expect(resolved.channels.telegram.busyMessageMode).toBe("steer");
    expect(resolved.channels.qq.unknown).toBeUndefined();
    expect(resolved.channels.telegram.unknown).toBeUndefined();
  });
});

describe("qq adapter default wiring", () => {
  test("registry default factory constructs the gateway adapter without socket injection", () => {
    const registry = createDefaultAgentChannelRegistry();
    const adapter = registry.create("qq", {
      enabled: true,
      appId: "app",
      appSecret: "secret",
    } as never);
    expect(adapter.kind).toBe("qq");
    expect(adapter.capabilities.markdown).toBe("markdown");
  });

  test("rejects adapters without an explicit lifecycle state contract", () => {
    const registry = createDefaultAgentChannelRegistry({
      factories: [
        {
          kind: "qq",
          create: () => ({}) as never,
        },
      ],
    });

    expect(() => registry.create("qq", { enabled: true } as never)).toThrow("getConnectionState() is required");
  });

  test("native Markdown is enabled by default and can be disabled", () => {
    const plain = new AgentQqChannelAdapter({ appId: "app", appSecret: "secret" });
    const disabled = new AgentQqChannelAdapter({ appId: "app", appSecret: "secret", markdownSupport: false });
    expect(plain.capabilities.markdown).toBe("markdown");
    expect(disabled.capabilities.markdown).toBe("plain");
  });
});
