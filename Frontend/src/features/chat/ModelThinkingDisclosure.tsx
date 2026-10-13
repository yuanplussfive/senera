import { useLayoutEffect, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import type { ModelThinkingBlock } from "../../store/session/types";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import {
  AppIcon,
  ThinkingIndicator,
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "../../shared/ui";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";
import { StableActivitySlot, textShimmerStyle } from "../../shared/motion";
import { LiveActivityStatus } from "../workflow/LiveActivityStatus";

export interface ModelThinkingProjection {
  preview: string;
  firstPreview: string;
  transcript: string;
  streaming: boolean;
  blocks: readonly ModelThinkingProjectionBlock[];
}

export interface ModelThinkingProjectionBlock {
  id: string;
  content: string;
  status: ModelThinkingBlock["status"];
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
    .map(({ block }) => ({ id: block.id, content: block.content.trim(), status: block.status }))
    .filter(({ content }) => content.length > 0);
  const latest = content.at(-1);
  const firstPreview = readFirstThinkingSentence(content[0]?.content ?? "");

  return {
    preview: latest?.content ?? "",
    firstPreview,
    transcript: content.map(({ content: text }) => text).join("\n\n"),
    streaming: latest?.status === "streaming",
    blocks: content,
  };
}

function readFirstThinkingSentence(value: string): string {
  // A streamed block can contain several markdown paragraphs. Keep the
  // compact header anchored to the first real line instead of flattening the
  // whole block into one run-on label.
  const firstLine =
    value
      .split(/\r?\n+/u)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const normalized = firstLine.replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  const sentence = normalized.match(/^.*?(?:[.!?。！？](?=\s|$)|$)/u)?.[0]?.trim();
  return sentence || normalized;
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
  if (!projection.transcript) {
    return blocks === undefined && showSummaryWhenEmpty ? (
      <ThinkingSummaryBar run={run} presentation={presentation} />
    ) : null;
  }
  return <ModelThinkingDisclosure projection={{ ...projection, streaming: current }} />;
}

function ModelThinkingDisclosure({ projection }: { projection: ModelThinkingProjection }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);

  return (
    <ThinkingSteps
      ref={flowRef}
      open={expanded}
      onOpenChange={setExpanded}
      rail="organic"
      className="model-thinking-flow min-w-0"
      data-model-thinking-disclosure
      data-live-activity={projection.streaming || undefined}
    >
      <StableActivitySlot
        stateKey={projection.streaming ? "thinking-streaming" : "thinking-complete"}
        preserveChildAnimations={projection.streaming}
      >
        <ThinkingStepsHeader
          className="activity-feed-row pointer-events-auto relative cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          data-activity-feed-row
          data-model-thinking-toggle-row
          aria-label={frontendMessage(expanded ? "chat.thinking.collapseTranscript" : "chat.thinking.expandTranscript")}
        >
          <span
            className={`activity-feed-row__icon model-thinking-flow__brain thinking-status-icon${projection.streaming ? " thinking-status-icon--active" : ""}`}
            aria-hidden="true"
          >
            <AppIcon icon="brain" size={16} />
          </span>
          <span
            className={`activity-feed-row__content model-thinking-preview min-w-0 font-medium text-content-primary${projection.streaming ? " model-thinking-preview--streaming motion-safe:animate-text-shimmer" : ""}`}
            aria-live={projection.streaming ? "polite" : undefined}
            data-live-activity-text={projection.streaming || undefined}
            data-model-thinking-first-preview
            data-model-thinking-preview={
              projection.preview.trim() === projection.firstPreview.trim() ? true : undefined
            }
          >
            <LazyMarkdownRenderer compact>{projection.firstPreview}</LazyMarkdownRenderer>
          </span>
        </ThinkingStepsHeader>
        <div
          className="sr-only"
          aria-hidden="true"
          data-thinking-status-icon
          data-thinking-status-active={projection.streaming || undefined}
        >
          <ThinkingIndicator size="compact" showLabel={false} aria-label={frontendMessage("chat.activity.thinking")} />
        </div>
        {projection.preview.trim() !== projection.firstPreview.trim() ? (
          <div
            className={`sr-only model-thinking-preview${projection.streaming ? " model-thinking-preview--streaming motion-safe:animate-text-shimmer" : ""}`}
            aria-live={projection.streaming ? "polite" : undefined}
            data-live-activity-text={projection.streaming || undefined}
            style={textShimmerStyle(projection.preview)}
            data-model-thinking-preview
          >
            <LazyMarkdownRenderer compact>{projection.preview}</LazyMarkdownRenderer>
          </div>
        ) : null}
      </StableActivitySlot>
      <ThinkingStepsContent
        unmountOnClose
        className="mt-1 max-h-[min(28rem,55vh)] overflow-y-auto px-0.5 scrollbar-thin"
      >
        <div data-model-thinking-transcript>
          {projection.blocks.map((block, index) => (
            <ThinkingStep
              key={block.id}
              showIcon={false}
              connector={false}
              status={projection.streaming && index === projection.blocks.length - 1 ? "active" : "complete"}
              isLast={index === projection.blocks.length - 1}
            >
              <div className="min-w-0 text-[13px] leading-6 text-content-primary">
                <LazyMarkdownRenderer compact lightweightCode>
                  {block.content}
                </LazyMarkdownRenderer>
              </div>
            </ThinkingStep>
          ))}
        </div>
      </ThinkingStepsContent>
      <ThinkingRail rootRef={flowRef} visible={expanded} />
    </ThinkingSteps>
  );
}

interface ThinkingRailGeometry {
  path: string;
  width: number;
  height: number;
  end: { x: number; y: number };
}

function ThinkingRail({
  rootRef,
  visible,
}: {
  rootRef: { current: HTMLDivElement | null };
  visible: boolean;
}): JSX.Element | null {
  const [geometry, setGeometry] = useState<ThinkingRailGeometry | null>(null);

  useLayoutEffect(() => {
    if (!visible) {
      setGeometry(null);
      return;
    }

    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const brain = root.querySelector<HTMLElement>(".model-thinking-flow__brain");
        const nodes = [...root.querySelectorAll<HTMLElement>("[data-thinking-step-node]")];
        if (!brain || nodes.length === 0) {
          setGeometry(null);
          return;
        }

        const rootRect = root.getBoundingClientRect();
        const brainRect = brain.getBoundingClientRect();
        const points = nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2 - rootRect.left,
            y: rect.top + rect.height / 2 - rootRect.top,
          };
        });
        const contentNodes = [...root.querySelectorAll<HTMLElement>("[data-thinking-step-content]")];
        const start = {
          x: brainRect.left + brainRect.width / 2 - rootRect.left,
          y: brainRect.top + brainRect.height / 2 - rootRect.top,
        };
        const first = points[0];
        const verticalGap = Math.max(0, first.y - start.y);
        const curveDepth = Math.max(18, Math.min(36, verticalGap * 0.56));
        const direction = first.x >= start.x ? 1 : -1;
        const lateralBend = Math.max(14, Math.min(22, Math.abs(first.x - start.x) + 12));
        const bendX = first.x + direction * lateralBend;
        const lastPoint = points.at(-1)!;
        const lastContentRect = contentNodes.at(-1)?.getBoundingClientRect();
        const end = {
          x: lastPoint.x,
          y: Math.max(
            lastPoint.y + 18,
            (lastContentRect?.bottom ?? rootRect.top + lastPoint.y + 12) - rootRect.top + 6,
          ),
        };
        const path = [
          `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
          `C ${start.x.toFixed(2)} ${(start.y + curveDepth).toFixed(2)} ${bendX.toFixed(2)} ${(first.y - curveDepth).toFixed(2)} ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
          ...points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
          `L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
        ].join(" ");

        const nextGeometry = {
          path,
          width: Math.max(rootRect.width, 1),
          height: Math.max(rootRect.height, 1),
          end,
        };
        setGeometry((previous) =>
          previous &&
          previous.path === nextGeometry.path &&
          previous.width === nextGeometry.width &&
          previous.height === nextGeometry.height
            ? previous
            : nextGeometry,
        );
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(root);
    const transcript = root.querySelector<HTMLElement>("[data-model-thinking-transcript]");
    if (transcript) resizeObserver?.observe(transcript);
    transcript?.addEventListener("scroll", measure, { passive: true });
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            const nextTranscript = root.querySelector<HTMLElement>("[data-model-thinking-transcript]");
            if (nextTranscript) resizeObserver?.observe(nextTranscript);
            measure();
          });
    mutationObserver?.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      transcript?.removeEventListener("scroll", measure);
    };
  }, [rootRef, visible]);

  if (!visible || !geometry) return null;

  return (
    <svg
      className="model-thinking-flow__rail"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-model-thinking-rail
    >
      <path d={geometry.path} />
      <circle
        className="model-thinking-flow__rail-terminal"
        cx={geometry.end.x}
        cy={geometry.end.y}
        r="2"
        data-model-thinking-rail-terminal
      />
    </svg>
  );
}
