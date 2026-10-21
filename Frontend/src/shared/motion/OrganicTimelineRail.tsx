import { useLayoutEffect, useRef, useState } from "react";

interface OrganicTimelineRailGeometry {
  readonly path: string;
  readonly activePath: string | null;
  readonly width: number;
  readonly height: number;
  readonly end: { readonly x: number; readonly y: number };
}

export type OrganicTimelineRailPath = "entry" | "thread";

export interface OrganicTimelineRailProps {
  /** The committed timeline root. A callback ref owner supplies this value. */
  readonly root: HTMLElement | null;
  readonly originSelector: string;
  readonly nodeSelector: string;
  readonly contentSelector?: string;
  /** An optional node receives a short trace from the origin while it is highlighted. */
  readonly activeNodeSelector?: string;
  /** Changes when the caller highlights a different node without reflowing the rail. */
  readonly activeNodeKey?: string | null;
  readonly visible: boolean;
  readonly className: string;
  /** The transcript uses a terminal dot; dense event timelines do not. */
  readonly endMarker?: "dot" | "none";
  /** An entry rail settles into a spine; a thread ties every node together. */
  readonly path?: OrganicTimelineRailPath;
  readonly testId?: string;
  /**
   * A caller-owned layout identity for content whose DOM node count can remain
   * stable while its geometry changes, such as a live execution timeline.
   */
  readonly layoutVersion?: unknown;
}

/**
 * Draws the same organic entry curve used by the thinking transcript over a
 * sequence of independently laid-out nodes. The DOM remains the source of
 * truth for geometry, so wrapping, font changes, and live updates cannot
 * desynchronize the connector from its timeline.
 */
export function OrganicTimelineRail({
  root,
  originSelector,
  nodeSelector,
  contentSelector,
  activeNodeSelector,
  activeNodeKey,
  visible,
  className,
  endMarker = "dot",
  path: pathKind = "entry",
  testId,
  layoutVersion,
}: OrganicTimelineRailProps): JSX.Element | null {
  const [geometry, setGeometry] = useState<OrganicTimelineRailGeometry | null>(null);
  const measureRef = useRef<(() => void) | null>(null);

  // Hover selection is a presentation change, not a layout change. Re-measure
  // the active trace after React commits the new data attribute without
  // recreating the observers that keep the base rope aligned to live content.
  useLayoutEffect(() => {
    measureRef.current?.();
  }, [activeNodeKey]);

  useLayoutEffect(() => {
    if (!visible) {
      setGeometry(null);
      return;
    }

    if (!root) return;

    let disposed = false;
    let frame = 0;
    const measure = (): void => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const origin = root.querySelector<HTMLElement>(originSelector);
        const nodes = [...root.querySelectorAll<HTMLElement>(nodeSelector)];
        if (!origin || nodes.length === 0) {
          setGeometry(null);
          return;
        }

        const rootRect = root.getBoundingClientRect();
        const originRect = origin.getBoundingClientRect();
        const points = nodes.map((node) => pointAtCenter(node, rootRect));
        const originPoint = pointAtCenter(origin, rootRect);
        const contentNodes = contentSelector ? [...root.querySelectorAll<HTMLElement>(contentSelector)] : [];
        const activeNode = activeNodeSelector ? root.querySelector<HTMLElement>(activeNodeSelector) : null;
        const activeIndex = activeNode ? nodes.indexOf(activeNode) : -1;
        const lastPoint = points.at(-1)!;
        const lastContentRect = contentNodes.at(-1)?.getBoundingClientRect();
        const threadPath = pathKind === "thread";
        // A thread ties actual attachment points together. Unlike a transcript
        // entry rail, it must neither enter before the first ordinal nor extend
        // below the terminal ordinal when its content wraps.
        const start = threadPath ? points[0]! : originPoint;
        const end = threadPath
          ? lastPoint
          : {
              x: lastPoint.x,
              y: Math.max(
                lastPoint.y + originRect.height,
                (lastContentRect?.bottom ?? rootRect.top + lastPoint.y) - rootRect.top,
              ),
            };
        const path = createOrganicPath({
          kind: pathKind,
          start,
          points: threadPath ? points.slice(1, -1) : points,
          end,
          originIndex: nodes.indexOf(origin),
          threadSway: readThreadSway(points, rootRect, contentNodes),
        });
        const activePath =
          activeIndex >= 0
            ? createOrganicPath({
                kind: pathKind,
                start,
                points: threadPath ? points.slice(1, activeIndex) : points.slice(0, activeIndex + 1),
                end: points[activeIndex]!,
                originIndex: nodes.indexOf(origin),
                threadSway: readThreadSway(points.slice(0, activeIndex + 1), rootRect, contentNodes),
              })
            : null;
        const nextGeometry = {
          path,
          activePath,
          width: Math.max(rootRect.width, 1),
          height: Math.max(rootRect.height, 1),
          end,
        };
        setGeometry((previous) => (isSameGeometry(previous, nextGeometry) ? previous : nextGeometry));
      });
    };

    const observedTargets = new Set<Element>();
    const observeGeometryTargets = (observer: ResizeObserver | null): void => {
      if (!observer) return;
      const targetSelector = [originSelector, nodeSelector, contentSelector]
        .filter((selector): selector is string => Boolean(selector))
        .join(", ");
      const targets = new Set<Element>([root, ...root.querySelectorAll<HTMLElement>(targetSelector)]);
      for (const target of observedTargets) {
        if (targets.has(target)) continue;
        observer.unobserve(target);
        observedTargets.delete(target);
      }
      for (const target of targets) {
        if (observedTargets.has(target)) continue;
        observer.observe(target);
        observedTargets.add(target);
      }
    };

    measureRef.current = measure;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observeGeometryTargets(resizeObserver);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            observeGeometryTargets(resizeObserver);
            measure();
          });
    mutationObserver?.observe(root, { characterData: true, childList: true, subtree: true });
    root.addEventListener("scroll", measure, { capture: true, passive: true });
    measure();
    void document.fonts?.ready.then(measure);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.removeEventListener("scroll", measure, { capture: true });
      if (measureRef.current === measure) measureRef.current = null;
    };
  }, [activeNodeSelector, contentSelector, layoutVersion, nodeSelector, originSelector, pathKind, root, visible]);

  if (!visible || !geometry) return null;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      {...(testId ? { [testId]: true } : {})}
    >
      {pathKind !== "thread" ? <path d={geometry.path} className="organic-timeline-rail__base" /> : null}
      {geometry.activePath ? <path d={geometry.activePath} className="organic-timeline-rail__active" /> : null}
      {endMarker === "dot" ? <circle cx={geometry.end.x} cy={geometry.end.y} r="2" /> : null}
    </svg>
  );
}

function pointAtCenter(element: HTMLElement, root: DOMRect): { readonly x: number; readonly y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - root.left,
    y: rect.top + rect.height / 2 - root.top,
  };
}

function createOrganicPath({
  kind,
  start,
  points,
  end,
  originIndex,
  threadSway,
}: {
  readonly kind: OrganicTimelineRailPath;
  readonly start: { readonly x: number; readonly y: number };
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly end: { readonly x: number; readonly y: number };
  readonly originIndex: number;
  readonly threadSway: number;
}): string {
  if (kind === "thread") return createThreadPath(start, points, end, threadSway);

  // The origin may itself be the first node. In that form the rail begins at
  // a real timeline event and bends only into its successor, rather than
  // drawing a zero-length curve over the event marker.
  const followingPoints = originIndex >= 0 ? points.slice(originIndex + 1) : points;
  const segments =
    followingPoints.length > 0
      ? [
          organicEntryCurve(start, followingPoints[0]!),
          ...followingPoints.slice(1).map((point) => `L ${formatPoint(point)}`),
        ]
      : [`M ${formatPoint(start)}`];
  return [...segments, `L ${formatPoint(end)}`].join(" ");
}

function createThreadPath(
  start: { readonly x: number; readonly y: number },
  points: readonly { readonly x: number; readonly y: number }[],
  end: { readonly x: number; readonly y: number },
  sway: number,
): string {
  const segments = points.reduce<string[]>(
    (path, point, index) => {
      const previous = index === 0 ? start : points[index - 1]!;
      return [...path, slackenedThreadSegment(previous, point, sway, index)];
    },
    [`M ${formatPoint(start)}`],
  );
  return [...segments, `L ${formatPoint(end)}`].join(" ");
}

function readThreadSway(
  points: readonly { readonly x: number; readonly y: number }[],
  root: DOMRect,
  contentNodes: readonly HTMLElement[],
): number {
  if (contentNodes.length === 0) return 0;
  const leftBoundary = Math.min(...points.map((point) => point.x));
  const contentBoundary = Math.min(...contentNodes.map((content) => content.getBoundingClientRect().left - root.left));
  const rightBoundary = Math.max(...points.map((point) => contentBoundary - point.x));
  // The thread may move through its ordinal labels, but it stays within the
  // measured lane between the root edge and the content column.
  // The rail owns the midpoint of its actual lane, never a guessed pixel
  // offset. This keeps the curve equally relaxed in a narrow dock and a wide
  // panel while leaving room for the ordinal itself.
  return Math.max(0, Math.min(leftBoundary, rightBoundary) * 0.45);
}

function slackenedThreadSegment(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  clearance: number,
  index: number,
): string {
  const horizontalDistance = end.x - start.x;
  const verticalDistance = end.y - start.y;
  const length = Math.hypot(horizontalDistance, verticalDistance);
  if (length === 0) return `L ${formatPoint(end)}`;

  // Each ordinal is a real attachment point. The bow scales with both the
  // available lane clearance and the measured span, so short rows remain
  // taut while taller result rows create a relaxed thread without touching
  // the content column.
  const normal = { x: -verticalDistance / length, y: horizontalDistance / length };
  // A continuous S curve preserves tangent direction at every attachment
  // point. The bend grows from measured clearance and segment length, rather
  // than treating every step as an identical fixed zig-zag.
  const bow = Math.min(clearance * 0.58, length * 0.14);
  const side = index % 2 === 0 ? 1 : -1;
  const controlOffset = { x: normal.x * bow * side, y: normal.y * bow * side };
  const firstControl = {
    x: start.x + horizontalDistance / 3 + controlOffset.x,
    y: start.y + verticalDistance / 3 + controlOffset.y,
  };
  const secondControl = {
    x: end.x - horizontalDistance / 3 + controlOffset.x,
    y: end.y - verticalDistance / 3 + controlOffset.y,
  };
  return `C ${formatPoint(firstControl)} ${formatPoint(secondControl)} ${formatPoint(end)}`;
}

function organicEntryCurve(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): string {
  const verticalGap = Math.max(0, end.y - start.y);
  // A connector may begin only a few pixels above its first node. Its control
  // points stay inside the start/end envelope, so a narrow timeline never
  // grows a hook into adjacent content.
  const curveDepth = Math.min(Math.max(verticalGap * 0.42, 4), 24, verticalGap / 2);
  const horizontalGap = end.x - start.x;
  const horizontalTension = Math.min(Math.abs(horizontalGap) * 0.42, 12);
  const direction = Math.sign(horizontalGap);
  const firstControlX = start.x + direction * horizontalTension;
  const secondControlX = end.x - direction * horizontalTension;
  return [
    `M ${formatPoint(start)}`,
    `C ${firstControlX.toFixed(2)} ${(start.y + curveDepth).toFixed(2)} ${secondControlX.toFixed(2)} ${(end.y - curveDepth).toFixed(2)} ${formatPoint(end)}`,
  ].join(" ");
}

function formatPoint(point: { readonly x: number; readonly y: number }): string {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function isSameGeometry(
  previous: OrganicTimelineRailGeometry | null,
  next: OrganicTimelineRailGeometry,
): previous is OrganicTimelineRailGeometry {
  return (
    previous !== null &&
    previous.path === next.path &&
    previous.activePath === next.activePath &&
    previous.width === next.width &&
    previous.height === next.height
  );
}
