import { describe, expect, test } from "vitest";
import {
  AgentProfileRouteRegistry,
  createAgentConversationSpace,
} from "../../../Source/AgentSystem/Conversation/AgentConversationSpace.js";

describe("conversation spaces and ProfileRoutes", () => {
  test("selects the most specific declarative route", () => {
    const routes = new AgentProfileRouteRegistry([
      { id: "channel-default", selector: { surface: "channel", platform: "qq" }, profileId: "qq-default" },
      {
        id: "qq-group",
        priority: 1,
        selector: { surface: "channel", platform: "qq", chatType: "group" },
        profileId: "qq-group",
      },
    ]);

    expect(routes.resolve({ surface: "channel", platform: "qq", chatType: "group", chatId: "g1" })).toMatchObject({
      status: "matched",
      route: { id: "qq-group" },
    });
    expect(routes.resolve({ surface: "channel", platform: "qq", chatType: "direct" })).toMatchObject({
      status: "matched",
      route: { id: "channel-default" },
    });
  });

  test("reports ambiguous equal matches instead of silently choosing one", () => {
    const routes = new AgentProfileRouteRegistry([
      { id: "a", selector: { surface: "channel", platform: "qq" }, profileId: "one" },
      { id: "b", selector: { surface: "channel", platform: "qq" }, profileId: "two" },
    ]);
    expect(routes.resolve({ surface: "channel", platform: "qq" })).toMatchObject({
      status: "ambiguous",
      candidates: [{ id: "a" }, { id: "b" }],
    });
    expect(() =>
      createAgentConversationSpace({
        sessionId: "session-a",
        address: { surface: "channel", platform: "qq" },
        routes,
      }),
    ).toThrow(/multiple ProfileRoutes/u);
  });

  test("keeps durable conversations isolated while hiding channel identifiers", () => {
    const first = createAgentConversationSpace({
      sessionId: "session-a",
      address: { surface: "channel", platform: "qq", chatType: "direct", chatId: "chat-1", userId: "user-1" },
      cacheFamily: "channel-finalization:qq",
    });
    const second = createAgentConversationSpace({
      sessionId: "session-b",
      address: { surface: "channel", platform: "qq", chatType: "direct", chatId: "chat-1", userId: "user-1" },
      cacheFamily: "channel-finalization:qq",
    });
    expect(first.id).not.toContain("chat-1");
    expect(first.logicalCacheScope).not.toBe(second.logicalCacheScope);
    expect(first.id).not.toBe(second.id);
    expect(first.routeRevision).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("does not rotate an unrelated space when another route changes", () => {
    const first = createAgentConversationSpace({
      sessionId: "session-a",
      address: { surface: "channel", platform: "qq", chatType: "direct", chatId: "chat-1", userId: "user-1" },
      routes: new AgentProfileRouteRegistry([
        { id: "qq", selector: { surface: "channel", platform: "qq" }, profileId: "qq-profile" },
        { id: "telegram", selector: { surface: "channel", platform: "telegram" }, profileId: "telegram-v1" },
      ]),
    });
    const second = createAgentConversationSpace({
      sessionId: "session-a",
      address: { surface: "channel", platform: "qq", chatType: "direct", chatId: "chat-1", userId: "user-1" },
      routes: new AgentProfileRouteRegistry([
        { id: "qq", selector: { surface: "channel", platform: "qq" }, profileId: "qq-profile" },
        { id: "telegram", selector: { surface: "channel", platform: "telegram" }, profileId: "telegram-v2" },
      ]),
    });

    expect(second.id).toBe(first.id);
    expect(second.logicalCacheScope).toBe(first.logicalCacheScope);
  });
});
