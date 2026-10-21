import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import type { ModelThinkingBlock } from "../../store/session/types";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { MotionDisclosure } from "../../shared/motion";
import { AppIcon } from "../../shared/ui";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";
import { LiveActivityStatus } from "../workflow/LiveActivityStatus";
import "./ModelThinkingDisclosure.css";

export interface ModelThinkingProjection {
  firstPreview: string;
  streaming: boolean;
  blocks: readonly ModelThinkingProjectionBlock[];
}

export interface ModelThinkingProjectionBlock {
  id: string;
  content: string;
  step: number;
  messageIndex: number;
}

/**
 * The live "Thinking" row uses the same activity-row geometry as execution
 * items. It is rendered in the active response stage so the first visible
 * thinking block replaces this row in place instead of moving a trailing slot.
 */
export function InitialThinkingIndicator({ active = true }: { active?: boolean }): JSX.Element {
  return <LiveActivityStatus active={active} dataInitialThinking={active} />;
}

export function projectModelThinking(blocks: readonly ModelThinkingBlock[] = []): ModelThinkingProjection {
  const content = [...blocks]
    .map((block, order) => ({ block, order }))
    .sort(
      (left, right) =>
        left.block.step - right.block.step ||
        left.block.messageIndex - right.block.messageIndex ||
        left.block.contentIndex - right.block.contentIndex ||
        left.order - right.order,
    )
    .map(({ block }) => ({
      id: block.id,
      content: block.content.trim(),
      status: block.status,
      step: block.step,
      messageIndex: block.messageIndex,
    }))
    .filter(({ content: value }) => value.length > 0);
  const latest = content.at(-1);
  const normalizedBlocks = content.map(({ id, content: value, step, messageIndex }) => ({
    id,
    content: value,
    step,
    messageIndex,
  }));

  return {
    // The compact line represents the latest model reasoning, rather than an
    // obsolete first delta from the same response.
    firstPreview: readFirstThinkingLine(latest?.content ?? ""),
    streaming: latest?.status === "streaming",
    blocks: normalizedBlocks,
  };
}

function readFirstThinkingLine(value: string): string {
  const firstLine =
    value
      .split(/\r?\n+/u)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return firstLine.replace(/\s+/gu, " ").trim();
}

export function RunThinkingPresentation({
  run,
  blocks,
  current = false,
  presentation = "terminal-only",
  showSummaryWhenEmpty = true,
}: {
  run?: RunRecord;
  blocks?: readonly ModelThinkingBlock[];
  current?: boolean;
  presentation?: "terminal-only" | "live-final-answer";
  showSummaryWhenEmpty?: boolean;
}): JSX.Element | null {
  const projection = projectModelThinking(blocks ?? run?.thinkingBlocks);
  if (projection.blocks.length === 0) {
    return blocks === undefined && showSummaryWhenEmpty ? (
      <ThinkingSummaryBar run={run} presentation={presentation} />
    ) : null;
  }
  return <ModelThinkingDisclosure projection={{ ...projection, streaming: current }} />;
}

function ModelThinkingDisclosure({ projection }: { projection: ModelThinkingProjection }): JSX.Element {
  const [expanded, setExpanded] = useState(() => projection.streaming);
  const transcriptId = useId();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowLiveTail = useRef(true);
  const wasStreaming = useRef(projection.streaming);
  const latest = projection.blocks.at(-1);

  useEffect(() => {
    if (!wasStreaming.current && projection.streaming) {
      shouldFollowLiveTail.current = true;
      setExpanded(true);
    }
    if (wasStreaming.current && !projection.streaming) {
      setExpanded(false);
    }
    wasStreaming.current = projection.streaming;
  }, [projection.streaming]);

  useLayoutEffect(() => {
    if (!expanded || !projection.streaming || !shouldFollowLiveTail.current) return;
    const frame = requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript && shouldFollowLiveTail.current) {
        transcript.scrollTop = transcript.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, latest?.content, latest?.id, projection.streaming]);

  const handleTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    shouldFollowLiveTail.current = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 24;
  }, []);
  const status = frontendMessage(projection.streaming ? "chat.thinking.running" : "chat.thinking.completed");

  return (
    <section
      className="model-thinking-disclosure min-w-0"
      data-model-thinking-disclosure
      data-live-activity={projection.streaming || undefined}
    >
      <button
        type="button"
        className="model-thinking-disclosure__trigger"
        data-model-thinking-toggle-row
        aria-controls={transcriptId}
        aria-expanded={expanded}
        aria-label={frontendMessage(expanded ? "chat.thinking.collapseTranscript" : "chat.thinking.expandTranscript")}
        onClick={() => setExpanded((open) => !open)}
      >
        <span
          className={`model-thinking-disclosure__icon${projection.streaming ? " model-thinking-disclosure__icon--active" : ""}`}
          data-thinking-status-icon
          data-thinking-status-active={projection.streaming || undefined}
          data-live-activity-icon={projection.streaming || undefined}
          aria-hidden="true"
        >
          <AppIcon icon="activity" size={14} />
        </span>
        <span className="model-thinking-disclosure__summary" aria-live={projection.streaming ? "polite" : undefined}>
          <span className="model-thinking-disclosure__label">{status}</span>
          {projection.firstPreview ? (
            <span className="model-thinking-disclosure__connector" aria-hidden="true" data-thinking-preview-connector>
              <AppIcon icon="paperclip" size={12} strokeWidth={1.7} data-thinking-preview-paperclip />
            </span>
          ) : null}
          {projection.firstPreview ? (
            <span
              className="model-thinking-disclosure__preview model-thinking-preview"
              data-model-thinking-first-preview
              data-model-thinking-preview
            >
              <LazyMarkdownRenderer compact>{projection.firstPreview}</LazyMarkdownRenderer>
            </span>
          ) : null}
        </span>
        <span
          className={`model-thinking-disclosure__chevron${expanded ? " model-thinking-disclosure__chevron--open" : ""}`}
          aria-hidden="true"
        >
          <AppIcon icon="chevron-right" size={14} />
        </span>
      </button>
      <MotionDisclosure open={expanded} id={transcriptId} className="model-thinking-disclosure__content">
        <div
          ref={transcriptRef}
          className="model-thinking-disclosure__transcript"
          data-model-thinking-transcript
          onScroll={handleTranscriptScroll}
        >
          {projection.blocks.map((block, index) => (
            <ThinkingTranscriptBlock
              key={block.id}
              block={block}
              startsModelRequest={index > 0 && isNewModelRequest(projection.blocks[index - 1], block)}
            />
          ))}
        </div>
      </MotionDisclosure>
    </section>
  );
}

const ThinkingTranscriptBlock = memo(function ThinkingTranscriptBlock({
  block,
  startsModelRequest,
}: {
  block: ModelThinkingProjectionBlock;
  startsModelRequest: boolean;
}): JSX.Element {
  return (
    <>
      {startsModelRequest ? <div className="model-thinking-disclosure__break" aria-hidden="true" /> : null}
      <div className="model-thinking-disclosure__entry" data-model-thinking-entry>
        <LazyMarkdownRenderer compact lightweightCode>
          {block.content}
        </LazyMarkdownRenderer>
      </div>
    </>
  );
});

function isNewModelRequest(previous: ModelThinkingProjectionBlock, next: ModelThinkingProjectionBlock): boolean {
  return previous.step !== next.step || previous.messageIndex !== next.messageIndex;
}
