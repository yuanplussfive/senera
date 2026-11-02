import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import type { ModelThinkingBlock } from "../../store/session/types";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { StreamingMarkdownRenderer } from "../../shared/code/StreamingMarkdownRenderer";
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
  status: ModelThinkingBlock["status"];
  step: number;
  messageIndex: number;
}

interface ThinkingProjectionCacheEntry {
  sourceContent: string;
  id: string;
  status: ModelThinkingBlock["status"];
  step: number;
  messageIndex: number;
  projection: ModelThinkingProjectionBlock;
}

const thinkingProjectionBlockCache = new WeakMap<ModelThinkingBlock, ThinkingProjectionCacheEntry>();
const LIVE_TAIL_FOLLOW_EPSILON_PX = 24;

/**
 * The live "Thinking" row uses the same activity-row geometry as execution
 * items. It is rendered in the active response stage so the first visible
 * thinking block replaces this row in place instead of moving a trailing slot.
 */
export function InitialThinkingIndicator({ active = true }: { active?: boolean }): JSX.Element {
  return <LiveActivityStatus active={active} dataInitialThinking={active} />;
}

export function projectModelThinking(blocks: readonly ModelThinkingBlock[] = []): ModelThinkingProjection {
  const normalizedBlocks: ModelThinkingProjectionBlock[] = [];
  let latest: ModelThinkingProjectionBlock | undefined;

  for (const block of blocks) {
    const cached = thinkingProjectionBlockCache.get(block);
    const projected =
      cached &&
      cached.sourceContent === block.content &&
      cached.id === block.id &&
      cached.status === block.status &&
      cached.step === block.step &&
      cached.messageIndex === block.messageIndex
        ? cached.projection
        : {
            id: block.id,
            content: block.content.trim(),
            status: block.status,
            step: block.step,
            messageIndex: block.messageIndex,
          };
    if (projected !== cached?.projection) {
      thinkingProjectionBlockCache.set(block, {
        sourceContent: block.content,
        id: block.id,
        status: block.status,
        step: block.step,
        messageIndex: block.messageIndex,
        projection: projected,
      });
    }
    if (projected.content.length === 0) continue;
    normalizedBlocks.push(projected);
    latest = projected;
  }

  return {
    // The compact line represents the latest model reasoning, rather than an
    // obsolete first delta from the same response.
    firstPreview: readFirstThinkingLine(latest?.content ?? ""),
    streaming: latest?.status === "streaming",
    blocks: normalizedBlocks,
  };
}

function readFirstThinkingLine(value: string): string {
  const firstLine = value.match(/[^\r\n]*\S[^\r\n]*/u)?.[0]?.trim() ?? "";
  return firstLine.replace(/\s+/gu, " ").trim();
}

export function RunThinkingPresentation({
  run,
  blocks,
  presentation = "terminal-only",
  showSummaryWhenEmpty = true,
}: {
  run?: RunRecord;
  blocks?: readonly ModelThinkingBlock[];
  presentation?: "terminal-only" | "live-final-answer";
  showSummaryWhenEmpty?: boolean;
}): JSX.Element | null {
  const projection = projectModelThinking(blocks ?? run?.thinkingBlocks);
  if (projection.blocks.length === 0) {
    return blocks === undefined && showSummaryWhenEmpty ? (
      <ThinkingSummaryBar run={run} presentation={presentation} />
    ) : null;
  }
  return <ModelThinkingDisclosure projection={projection} />;
}

function ModelThinkingDisclosure({ projection }: { projection: ModelThinkingProjection }): JSX.Element {
  const [expanded, setExpanded] = useState(() => projection.streaming);
  const transcriptId = useId();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptContentRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowLiveTail = useRef(true);
  const tailSyncFrame = useRef<number | null>(null);
  const latest = projection.blocks.at(-1);
  const latestUnit = readThinkingUnitIdentity(latest);
  const lifecycleRef = useRef({ unit: latestUnit, streaming: projection.streaming });
  const liveTailState = useRef({ expanded, streaming: projection.streaming });
  liveTailState.current = { expanded, streaming: projection.streaming };

  useLayoutEffect(() => {
    const previous = lifecycleRef.current;
    const startedNewThinkingUnit = latestUnit !== undefined && latestUnit !== previous.unit && projection.streaming;
    const completedCurrentThinkingUnit = previous.unit === latestUnit && previous.streaming && !projection.streaming;

    if (startedNewThinkingUnit) {
      shouldFollowLiveTail.current = true;
      setExpanded(true);
    }
    if (completedCurrentThinkingUnit) {
      shouldFollowLiveTail.current = false;
      setExpanded(false);
    }
    lifecycleRef.current = { unit: latestUnit, streaming: projection.streaming };
  }, [latestUnit, projection.streaming]);

  const scheduleTailSync = useCallback(() => {
    if (tailSyncFrame.current !== null) return;
    tailSyncFrame.current = requestAnimationFrame(() => {
      tailSyncFrame.current = null;
      const transcript = transcriptRef.current;
      const live = liveTailState.current;
      if (transcript && live.expanded && live.streaming && shouldFollowLiveTail.current) {
        scrollTranscriptToLiveTail(transcript);
      }
    });
  }, []);

  useLayoutEffect(() => {
    if (!expanded || !projection.streaming) return;
    scheduleTailSync();
  }, [expanded, latest?.content, latest?.id, projection.streaming, scheduleTailSync]);

  useEffect(() => {
    if (!expanded || !projection.streaming) return;
    const transcript = transcriptRef.current;
    const content = transcriptContentRef.current;
    if (!transcript || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(scheduleTailSync);
    observer.observe(transcript);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, projection.streaming, scheduleTailSync]);

  useEffect(
    () => () => {
      if (tailSyncFrame.current !== null) cancelAnimationFrame(tailSyncFrame.current);
    },
    [],
  );

  const handleTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    shouldFollowLiveTail.current = isTranscriptAtLiveTail(transcript);
  }, []);
  const handleToggle = useCallback(() => {
    setExpanded((open) => {
      const next = !open;
      if (!next) shouldFollowLiveTail.current = false;
      else if (projection.streaming) shouldFollowLiveTail.current = true;
      return next;
    });
  }, [projection.streaming]);
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
        onClick={handleToggle}
      >
        <span
          className={`model-thinking-disclosure__icon${projection.streaming ? " model-thinking-disclosure__icon--active" : ""}`}
          data-thinking-status-icon
          data-thinking-status-active={projection.streaming || undefined}
          data-live-activity-icon={projection.streaming || undefined}
          aria-hidden="true"
        >
          <AppIcon icon="thinking" size={14} />
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
      <MotionDisclosure
        open={expanded}
        id={transcriptId}
        strategy="stable"
        className="model-thinking-disclosure__content"
      >
        <div
          ref={transcriptRef}
          className="model-thinking-disclosure__transcript"
          data-model-thinking-transcript
          data-senera-scroll-owner="thinking"
          onScroll={handleTranscriptScroll}
        >
          <div ref={transcriptContentRef} className="model-thinking-disclosure__transcript-content">
            {projection.blocks.map((block, index) => (
              <ThinkingTranscriptBlock
                key={block.id}
                block={block}
                streaming={projection.streaming && block.id === latest?.id && block.status === "streaming"}
                startsModelRequest={index > 0 && isNewModelRequest(projection.blocks[index - 1], block)}
              />
            ))}
          </div>
        </div>
      </MotionDisclosure>
    </section>
  );
}

const ThinkingTranscriptBlock = memo(function ThinkingTranscriptBlock({
  block,
  streaming,
  startsModelRequest,
}: {
  block: ModelThinkingProjectionBlock;
  streaming: boolean;
  startsModelRequest: boolean;
}): JSX.Element {
  return (
    <>
      {startsModelRequest ? <div className="model-thinking-disclosure__break" aria-hidden="true" /> : null}
      <div className="model-thinking-disclosure__entry" data-model-thinking-entry>
        {streaming ? (
          <StreamingMarkdownRenderer compact showCaret={false}>
            {block.content}
          </StreamingMarkdownRenderer>
        ) : (
          <LazyMarkdownRenderer compact lightweightCode>
            {block.content}
          </LazyMarkdownRenderer>
        )}
      </div>
    </>
  );
});

function isNewModelRequest(previous: ModelThinkingProjectionBlock, next: ModelThinkingProjectionBlock): boolean {
  return previous.step !== next.step || previous.messageIndex !== next.messageIndex;
}

function readThinkingUnitIdentity(block: ModelThinkingProjectionBlock | undefined): string | undefined {
  if (!block) return undefined;
  return `${block.step}:${block.messageIndex}:${block.id}`;
}

function scrollTranscriptToLiveTail(transcript: HTMLElement): void {
  const target = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
  if (transcript.scrollTop !== target) transcript.scrollTop = target;
}

function isTranscriptAtLiveTail(transcript: HTMLElement): boolean {
  return transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= LIVE_TAIL_FOLLOW_EPSILON_PX;
}
