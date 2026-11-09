import { useState } from "react";
import type { EventSourceChannel } from "../../api/eventTypes";
import { ScrollArea } from "../../shared/ui";
import type { SessionListEntry } from "../../store/selectors/chatSelectors";
import { SessionChannelList } from "./SessionChannelList";

const sessions: SessionListEntry[] = (["console", "onebot11", "onebot", "qq", "telegram", "discord"] as const).flatMap(
  (platform, channelIndex) =>
    Array.from({ length: [8, 8, 12, 128, 2][channelIndex] }, (_, index) => ({
      sessionId: `${platform}-${index}`,
      title:
        platform === "console"
          ? ["界面排版优化", "模型配置与检索", "这是一条很长的对话标题，用于检查侧栏的文字截断"][index % 3]
          : `群聊与私聊记录 · 10/25 ${12 - index}:23`,
      platform: platform as EventSourceChannel,
      accent: index === 1 ? "running" : index === 2 ? "failed" : "idle",
      updatedAt: new Date(Date.UTC(2026, 9, 25, 12 - index, 30 - channelIndex)).toISOString(),
    })),
);

export const Channels = () => {
  const [active, setActive] = useState<string | null>("onebot11-7");
  const [query, setQuery] = useState("");
  return (
    <main className="min-h-screen bg-surface-canvas p-4 text-content-primary">
      <aside className="flex h-[760px] max-h-[90vh] w-[280px] max-w-full flex-col bg-surface-sidebar p-2.5">
        <h1 className="mb-1 px-2 text-sm font-medium">当前工作区的对话</h1>
        <p className="mb-3 px-2 text-xs text-content-muted">点击渠道标题可收起整组对话</p>
        <input
          aria-label="搜索对话"
          placeholder="搜索对话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-3 h-8 rounded-md border border-line bg-surface-panel px-2 text-xs"
        />
        <ScrollArea className="min-h-0 flex-1">
          <SessionChannelList
            sessions={sessions.filter((session) => session.title.includes(query))}
            activeSessionId={active}
            revealAll={Boolean(query)}
            selectionMode={false}
            selectedSessionIds={new Set()}
            selectedSessionCount={0}
            onSelectSession={setActive}
            onToggleSessionSelection={() => {}}
            onEnterSelectionMode={() => {}}
            onClearSelection={() => {}}
            onDeleteSelected={() => {}}
            onRenameSession={() => {}}
            onDeleteSession={() => {}}
            onHoverSessionChange={() => {}}
          />
        </ScrollArea>
      </aside>
    </main>
  );
};
