import { describe, expect, test } from "vitest";
import { AgentChannelConversationGuard } from "../../../Source/AgentSystem/Channels/AgentChannelConversationGuard.js";

describe("channel conversation invalidation", () => {
  test("invalidates old asynchronous work and excludes duplicate clears", async () => {
    const guard = new AgentChannelConversationGuard();
    const oldWork = guard.capture("group");
    const unrelated = guard.capture("direct");
    let finish!: () => void;
    const pending = guard.clear("group", () => new Promise<void>((resolve) => (finish = resolve)));
    expect(oldWork()).toBe(false);
    expect(unrelated()).toBe(true);
    expect(guard.capture("group")()).toBe(false);
    await expect(
      guard.clear("group", async () => {
        throw new Error("Must not execute twice");
      }),
    ).resolves.toBe(false);
    finish();
    await expect(pending).resolves.toBe(true);
    expect(oldWork()).toBe(false);
    expect(guard.capture("group")()).toBe(true);
  });

  test("releases a failed clear without revalidating in-flight work", async () => {
    const guard = new AgentChannelConversationGuard();
    const oldWork = guard.capture("group");
    const failure = new Error("History store failed");
    await expect(
      guard.clear("group", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(guard.isClearing("group")).toBe(false);
    expect(oldWork()).toBe(false);
    await expect(guard.clear("group", async () => {})).resolves.toBe(true);
  });

  test("keeps each subsequent clear a distinct revision", async () => {
    const guard = new AgentChannelConversationGuard();
    await guard.clear("group", async () => {});
    const work = guard.capture("group");
    expect(work()).toBe(true);
    await guard.clear("group", async () => {});
    expect(work()).toBe(false);
  });
});
