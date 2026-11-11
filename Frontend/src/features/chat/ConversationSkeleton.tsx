import { motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/util";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import { ConversationFrame, Skeleton } from "../../shared/ui";

const ROLES = ["user", "assistant"] as const;
type SkeletonRole = (typeof ROLES)[number];

/** 首帧行数；测量结果通常在布局阶段就覆盖它，只在取不到布局时作为兜底。 */
const INITIAL_ROW_COUNT = 6;
/** 上限只约束 4K 级窗口与异常测量，正常轨道 8–13 行。 */
const MAX_ROW_COUNT = 40;
const ROW_STAGGER_SECONDS = 0.045;
/** 行数变多后级联延迟不再线性增长，否则末行要等 1.5s 才出现。 */
const MAX_STAGGER_STEPS = 5;

/**
 * 骨架行数由轨道高度决定：写死行数会在高窗口留下整块空白，在矮窗口把顶部行裁到
 * 视口外。行高取自真实渲染的两行，避免和 TSX 里的 h-* 尺寸重复维护。
 */
export function computeSkeletonRowCount({
  available,
  rowHeights,
  maxRows,
}: {
  available: number;
  rowHeights: readonly number[];
  maxRows: number;
}): number {
  const pitches = rowHeights.filter((height) => height > 0);
  if (available <= 0 || pitches.length === 0) return 2;
  let total = 0;
  let count = 0;
  while (total < available && count < maxRows) {
    total += pitches[count % pitches.length];
    count += 1;
  }
  return Math.max(2, count);
}

/**
 * 会话骨架：与真实消息流共用同一根轨道锚线（底对齐），行数补足到轨道高度。
 * 底对齐对应消息列表加载完成后的 `scrollToBottom` 落位，顶部被裁切的行即
 * “更早的历史”，与真实滚动状态一致。
 */
export function ConversationSkeleton(): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rowCount, setRowCount] = useState(INITIAL_ROW_COUNT);
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveMotionLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const list = listRef.current;
    if (!track || !list) return;
    const sync = (): void => {
      const [first, second] = Array.from(list.children) as HTMLElement[];
      if (!first || !second) return;
      const next = computeSkeletonRowCount({
        available: track.clientHeight,
        rowHeights: [first.offsetHeight, second.offsetHeight],
        maxRows: MAX_ROW_COUNT,
      });
      setRowCount((current) => (current === next ? current : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={trackRef}
      className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden"
      aria-hidden="true"
      data-conversation-skeleton
    >
      <div ref={listRef} className="flex flex-col">
        {Array.from({ length: rowCount }, (_, index) => (
          <SkeletonRow key={index} index={index} motionLevel={effectiveMotionLevel} />
        ))}
      </div>
    </div>
  );
}

/** 行内边距与真实 `.chat-message-item` 一致（pt-1 pb-5），行距即真实消息间距。 */
function SkeletonRow({ index, motionLevel }: { index: number; motionLevel: MotionLevel }): JSX.Element {
  const role: SkeletonRole = ROLES[index % ROLES.length];
  return (
    <motion.div
      initial={motionLevel === "none" ? false : "hidden"}
      animate="show"
      variants={readRowVariants(motionLevel, role === "user")}
      transition={
        motionLevel === "none"
          ? { duration: 0 }
          : { ...motionTimings.base, delay: Math.min(index, MAX_STAGGER_STEPS) * ROW_STAGGER_SECONDS }
      }
      className="pb-5 pt-1"
      data-skeleton-row={role}
    >
      {role === "user" ? <UserSkeletonRow index={index} /> : <AssistantSkeletonRow index={index} />}
    </motion.div>
  );
}

function UserSkeletonRow({ index }: { index: number }): JSX.Element {
  return (
    <ConversationFrame mode="user" className="items-start justify-end gap-3">
      <div className={cn("flex flex-col items-end", index % 4 === 0 ? "w-[46%]" : "w-[58%]")}>
        <Skeleton className="h-11 w-full rounded-2xl rounded-tr-[6px]" />
      </div>
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
    </ConversationFrame>
  );
}

function AssistantSkeletonRow({ index }: { index: number }): JSX.Element {
  return (
    <ConversationFrame mode="wide">
      <div className="flex min-w-0 items-start gap-4">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className={cn("min-w-0 flex-1", index % 4 === 1 ? "max-w-[72%]" : "max-w-[82%]")}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-[88%]" />
          <Skeleton className="mt-2 h-3 w-[62%]" />
        </div>
      </div>
    </ConversationFrame>
  );
}

function readRowVariants(level: MotionLevel, isUser: boolean) {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
    };
  }
  return {
    hidden: { opacity: 0, x: isUser ? 8 : -8, y: 3 },
    show: { opacity: 1, x: 0, y: 0 },
  };
}
