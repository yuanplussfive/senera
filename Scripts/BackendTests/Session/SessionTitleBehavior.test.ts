import { describe, expect, test, vi } from "vitest";
import path from "node:path";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import type { AgentSession } from "../../../Source/AgentSystem/Session/AgentSession.js";
import {
  AgentSessionTitleProjector,
  deriveAgentSessionTitle,
} from "../../../Source/AgentSystem/Session/AgentSessionTitleProjector.js";
import { AgentSessionEventFactory } from "../../../Source/AgentSystem/Session/AgentSessionEventFactory.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { createManagerFixture, userEntry } from "./SessionManagerTestFixtures.js";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "title-session",
    status: "idle",
    createdAt: "2026-12-31T16:02:03.000Z",
    updatedAt: "2026-12-31T16:02:03.000Z",
    conversation: [],
    ...overrides,
  };
}

describe("session title authority", () => {
  test("uses a real user request after host events in live and persisted history", () => {
    const directory = createTemporaryDirectory("senera-host-title");
    const repository = new SqliteSessionRepository(path.join(directory, "sessions.sqlite"));
    try {
      const value = session({
        conversation: [
          {
            ...userEntry("notice", "Child completed"),
            metadata: { hostInput: { kind: "agent_completion", sourceId: "child", deliveryId: "notice" } },
          },
          userEntry("human", "Read the files"),
        ],
      });
      repository.upsertSession(value);
      repository.appendEntries(
        value.id,
        value.conversation.map((entry, sequence) => ({ entry, sequence })),
      );
      expect(deriveAgentSessionTitle(value)).toBe("Read the files");
      expect(repository.loadFirstUserMessage(value.id)?.requestId).toBe("human");
    } finally {
      repository.close();
      removeDirectory(directory);
    }
  });

  test("untitled and empty event sessions show the default title", () => {
    expect(deriveAgentSessionTitle(session())).toBe("新对话");
    expect(deriveAgentSessionTitle(session({ conversation: [userEntry("event", "  ")] }))).toBe("新对话");
  });

  test.each(["group", "direct"] as const)(
    "OneBot %s titles use the conversation name and Shanghai creation minute",
    (chatType) => {
      expect(
        deriveAgentSessionTitle(
          session({
            title: "old first input",
            conversation: [userEntry("request", "消息内容不应成为 QQ 标题")],
            metadata: { channel: { platform: "onebot11", chatType, chatId: "chat", chatName: "  测试  对话  " } },
          }),
        ),
      ).toBe("测试 对话 · 01/01 00:02");
    },
  );

  test("explicit names win, even if the user names a session 新对话", () => {
    const value = session({
      metadata: {
        title: "新对话",
        channel: { platform: "onebot11", chatType: "group", chatId: "chat", chatName: "Group" },
      },
    });
    expect(deriveAgentSessionTitle(value)).toBe("新对话");
    value.metadata!.title = "我的标题";
    expect(deriveAgentSessionTitle(value)).toBe("我的标题");
  });

  test("catalog title projection reads history only when no title data is available", () => {
    const load = vi.fn(() => userEntry("first", "First user message"));
    const projector = new AgentSessionTitleProjector(load);
    const record = { ...session(), entryCount: 10, messageCount: 5 };
    expect(projector.project({ ...record, title: "Persisted title" })).toBe("Persisted title");
    expect(projector.project({ ...record, metadata: { title: "Renamed" } })).toBe("Renamed");
    expect(
      projector.project({
        ...record,
        metadata: { channel: { platform: "onebot11", chatType: "group", chatId: "chat", chatName: "Group" } },
      }),
    ).toBe("Group · 01/01 00:02");
    expect(load).not.toHaveBeenCalled();
    expect(projector.project(record)).toBe("First user message");
    expect(load).toHaveBeenCalledExactlyOnceWith(record.id);
  });

  test("SQLite, catalog and live snapshots share title rules without promoting cached titles to user renames", () => {
    const directory = createTemporaryDirectory("senera-session-titles");
    const repository = new SqliteSessionRepository(path.join(directory, "sessions.sqlite"));
    try {
      repository.upsertSession(session({ conversation: [userEntry("first", "First input")] }));
      const persisted = repository.loadSession("title-session")!;
      expect(persisted.title).toBe("First input");
      expect(persisted.metadata?.title).toBeUndefined();
      persisted.metadata = {
        agentId: "d5a8f0b1-2e98-43ee-9d4d-9be07b70d1b1",
        channel: { platform: "onebot11", chatType: "group", chatId: "chat", chatName: "Group" },
      };
      repository.upsertSession(persisted);
      const fixture = createManagerFixture({ repository });
      expect(fixture.manager.listSessions()[0]?.title).toBe("Group · 01/01 00:02");
      const loaded = repository.loadSession(persisted.id)!;
      expect(new AgentSessionEventFactory().snapshot(loaded).data).toMatchObject({
        title: "Group · 01/01 00:02",
        agentId: "d5a8f0b1-2e98-43ee-9d4d-9be07b70d1b1",
      });
      expect(fixture.store.getSessionSnapshot(persisted.id)).toMatchObject({
        title: "Group · 01/01 00:02",
        agentId: "d5a8f0b1-2e98-43ee-9d4d-9be07b70d1b1",
      });
      expect(fixture.store.getSessionAgentId(persisted.id)).toBe("d5a8f0b1-2e98-43ee-9d4d-9be07b70d1b1");
      repository.renameSession(persisted.id, "用户命名");
      const renamed = repository.loadSession(persisted.id)!;
      expect(renamed.metadata?.title).toBe("用户命名");
      expect(deriveAgentSessionTitle(renamed)).toBe("用户命名");
      expect(fixture.manager.listSessions()[0]?.title).toBe("用户命名");
    } finally {
      repository.close();
      removeDirectory(directory);
    }
  });
});
