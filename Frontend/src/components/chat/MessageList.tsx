import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { EditMessageDialog } from "./EditMessageDialog";
import { MessageRow, StreamingRow } from "./MessageRow";
import { useVirtuosoAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
  runs: RunRecord[];
  currentRun?: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  userProfile: UserProfile;
  onRegenerate: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 120;

type MessageListItem = ChatMessage | { __streaming: true; run: RunRecord };

function isStreamingListItem(item: MessageListItem): item is Extract<MessageListItem, { __streaming: true }> {
  return "__streaming" in item;
}

function readMessageListItemKey(item: MessageListItem): string {
  return isStreamingListItem(item) ? "__streaming__" : item.id;
}

export function MessageList({
  sessionId,
  messages,
  runs,
  currentRun,
  assistantAvatarIcon,
  selectedModelProvider,
  userProfile,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
}: MessageListProps): JSX.Element {
  const [editing, setEditing] = useState<{ id: string; message: ChatMessage } | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const runsByRequestId = useMemo(() => {
    const map = new Map<string, RunRecord>();
    for (const run of runs) map.set(run.requestId, run);
    return map;
  }, [runs]);
  const items = useMemo(
    () => (currentRun ? [...messages, { __streaming: true as const, run: currentRun }] : messages),
    [messages, currentRun],
  );
  const lastItemKey = items.length > 0 ? readMessageListItemKey(items[items.length - 1]) : "";
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: items.length,
    resetKey: `${sessionId}:${currentRun?.requestId ?? ""}`,
    activityKey: `${lastItemKey}:${currentRun?.revision ?? 0}`,
    bottomThreshold: MESSAGE_LIST_BOTTOM_THRESHOLD,
  });

  const closeEditor = (): void => {
    setEditing(null);
    setDraft("");
  };

  return (
    <>
      <Virtuoso
        ref={autoScroll.ref}
        scrollerRef={autoScroll.scrollerRef}
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        followOutput={autoScroll.followOutput}
        atBottomStateChange={autoScroll.atBottomStateChange}
        totalListHeightChanged={autoScroll.totalListHeightChanged}
        initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
        atBottomThreshold={MESSAGE_LIST_BOTTOM_THRESHOLD}
        overscan={{ main: 900, reverse: 900 }}
        computeItemKey={(_, item) => readMessageListItemKey(item)}
        itemContent={(_, item) => {
          if ("__streaming" in item) {
            return (
              <div className="chat-message-item mx-auto box-border w-full max-w-3xl px-4 pb-3 pt-1 sm:px-6">
                <StreamingRow
                  run={item.run}
                  assistantAvatarIcon={assistantAvatarIcon}
                  selectedModelProvider={selectedModelProvider}
                />
              </div>
            );
          }
          return (
            <div className="chat-message-item mx-auto box-border w-full max-w-3xl px-4 pb-3 pt-1 sm:px-6">
              <MessageRow
                message={item}
                run={item.requestId ? runsByRequestId.get(item.requestId) : undefined}
                onClickBubble={() => {
                  if (item.role !== "user") return;
                  if (!item.requestId) return;
                  setEditing({ id: item.id, message: item });
                  setDraft(item.content ?? "");
                }}
                assistantAvatarIcon={assistantAvatarIcon}
                selectedModelProvider={selectedModelProvider}
                userProfile={userProfile}
                onRegenerate={() => onRegenerate(item)}
                onDelete={() => setDeleting(item)}
                onViewWorkflow={() => onViewWorkflow(item)}
              />
            </div>
          );
        }}
        components={{
          Header: () => <div className="h-6" />,
          Footer: () => <div className="h-8" />,
        }}
      />
      <EditMessageDialog
        editing={editing}
        draft={draft}
        onDraftChange={setDraft}
        onClose={closeEditor}
        onSubmit={(target, next) => {
          onEditUserMessage(target, next);
          closeEditor();
        }}
      />
      <DeleteMessageDialog
        open={!!deleting}
        message={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={(target) => {
          onDeleteFromMessage(target);
          setDeleting(null);
        }}
      />
    </>
  );
}
