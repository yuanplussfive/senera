import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type NodeMouseHandler,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Lightbulb,
  Loader2,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  Check,
  X as XIcon,
} from "lucide-react";
import { useStore, type RunRecord } from "../store/sessionStore";
import { cn, formatDuration, formatTime } from "../lib/util";
import { Tooltip } from "./ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./ui/DropdownMenu";
import { StepNode } from "./canvas/StepNode";
import { layoutSteps, type StepNodeData } from "./canvas/layout";
import { NodeDetailDrawer } from "./canvas/NodeDetailDrawer";

const NODE_TYPES = { step: StepNode };

export function ThinkingTimeline({
  presentation = "auto",
  hidePanelTitle = false,
}: {
  presentation?: "auto" | "panel" | "rail";
  hidePanelTitle?: boolean;
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <ThinkingPanel presentation={presentation} hidePanelTitle={hidePanelTitle} />
    </ReactFlowProvider>
  );
}

function ThinkingPanel({
  presentation,
  hidePanelTitle,
}: {
  presentation: "auto" | "panel" | "rail";
  hidePanelTitle: boolean;
}): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const collapsed = useStore((s) => s.rightPanelCollapsed);
  const toggleCollapsed = useStore((s) => s.toggleRightPanel);
  const viewedRunId = useStore((s) =>
    activeId ? s.viewedRunIdBySession[activeId] : undefined,
  );
  const setViewedRun = useStore((s) => s.setViewedRun);

  const runs = session?.runs ?? [];
  const latestRun = runs[runs.length - 1];
  const selectedRun = useMemo(() => {
    if (!viewedRunId) return undefined;
    return runs.find((r) => r.requestId === viewedRunId);
  }, [runs, viewedRunId]);
  const isPinnedToHistory = !!selectedRun && selectedRun.requestId !== latestRun?.requestId;
  const run = isPinnedToHistory ? selectedRun : latestRun;

  useEffect(() => {
    if (!activeId) return;
    if (!viewedRunId) return;
    if (!selectedRun) {
      setViewedRun(activeId, undefined);
      return;
    }
    if (selectedRun.requestId === latestRun?.requestId) {
      setViewedRun(activeId, undefined);
    }
  }, [activeId, viewedRunId, selectedRun, latestRun?.requestId, setViewedRun]);

  const isRail = presentation === "rail" || (presentation === "auto" && collapsed);
  if (isRail) {
    return (
      <aside className="flex h-full w-[44px] shrink-0 flex-col items-center border-l border-ink-200/60 bg-paper-100/40 py-3">
        <Tooltip content="展开思考过程" side="left">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            aria-label="expand"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        </Tooltip>
        <Lightbulb className="mt-2 h-4 w-4 text-terra-500" />
        {run ? (
          <div className="mt-2 rotate-180 font-mono text-[10px] uppercase tracking-wider text-ink-400" style={{ writingMode: "vertical-rl" }}>
            {run.steps.length} 步
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className={cn(
      "flex h-full shrink-0 flex-col border-l border-ink-200/60 bg-paper-100/40",
      presentation === "panel" ? "w-full border-l-0" : "w-[460px]",
    )}>
      <TopBar
        run={run}
        runs={runs}
        currentRunId={run?.requestId}
        pinnedToHistory={isPinnedToHistory}
        hideTitle={hidePanelTitle}
        onSelect={(rid) => activeId && setViewedRun(activeId, rid)}
        onFollowLatest={() => activeId && setViewedRun(activeId, undefined)}
        onCollapse={presentation === "panel" ? undefined : toggleCollapsed}
      />
      <CanvasArea run={run} />
    </aside>
  );
}

// ---------- 顶栏 ----------

function TopBar({
  run,
  runs,
  currentRunId,
  pinnedToHistory,
  hideTitle,
  onSelect,
  onFollowLatest,
  onCollapse,
}: {
  run?: RunRecord;
  runs: RunRecord[];
  currentRunId?: string;
  pinnedToHistory: boolean;
  hideTitle?: boolean;
  onSelect: (requestId: string) => void;
  onFollowLatest: () => void;
  onCollapse?: () => void;
}): JSX.Element {
  const completed = run?.steps.filter((s) => s.status === "done").length ?? 0;
  const failed = run?.steps.filter((s) => s.status === "failed").length ?? 0;
  const total = run?.steps.length ?? 0;
  const rf = useReactFlow();
  const fit = (): void => {
    try {
      rf.fitView({ padding: 0.16, duration: 240 });
    } catch {
      /* ignore */
    }
  };
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-ink-200/60 bg-paper-100/70 px-3">
        {onCollapse ? (
          <Tooltip content="收起思考过程" side="left">
            <button
              type="button"
              onClick={onCollapse}
              className="grid h-7 w-7 place-items-center rounded text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              aria-label="collapse"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </Tooltip>
        ) : null}
        {hideTitle ? null : (
          <>
            <Lightbulb className="h-4 w-4 text-terra-500" />
            <span className="text-[13px] font-medium text-ink-800">思考过程</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
          {run?.status === "running" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-terra-50 px-1.5 py-0.5 text-terra-600">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              live
            </span>
          ) : null}
          {run ? (
            <span>
              {completed}/{total}
              {failed > 0 ? <span className="ml-1 text-brick-500">·{failed} 失败</span> : null}
            </span>
          ) : null}
          {pinnedToHistory ? (
            <button
              type="button"
              onClick={onFollowLatest}
              className="rounded-full bg-paper-50 px-1.5 py-0.5 text-[10px] text-ink-500 transition hover:bg-paper-200 hover:text-ink-800"
            >
              跟随最新
            </button>
          ) : null}
          <Tooltip content="自适应窗口" side="bottom">
            <button
              type="button"
              onClick={fit}
              className="grid h-6 w-6 place-items-center rounded text-ink-400 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
              aria-label="fit"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Run 选择器 */}
      {runs.length > 0 ? (
        <RunSelector
          runs={runs}
          currentRunId={currentRunId}
          onSelect={onSelect}
          pinnedToHistory={pinnedToHistory}
        />
      ) : null}
    </>
  );
}

function RunSelector({
  runs,
  currentRunId,
  onSelect,
  pinnedToHistory,
}: {
  runs: RunRecord[];
  currentRunId?: string;
  onSelect: (id: string) => void;
  pinnedToHistory: boolean;
}): JSX.Element {
  const current = runs.find((r) => r.requestId === currentRunId) ?? runs[runs.length - 1];
  const reversed = [...runs].reverse(); // 最新在前
  return (
    <div className="border-b border-ink-200/40 bg-paper-50/70 px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-start gap-2 rounded-lg border border-ink-200/60 bg-paper-100/70 px-3 py-2 text-left transition hover:border-ink-300 hover:bg-paper-100"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                <RunStatusBadge status={current.status} />
                <span>
                  {runs.length === 1
                    ? "唯一一轮"
                    : !pinnedToHistory
                    ? "最新一轮"
                    : `第 ${runs.indexOf(current) + 1} / ${runs.length} 轮`}
                </span>
                <span>· {formatDuration(current.startedAt, current.endedAt)}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[12.5px] text-ink-800">
                {current.input || "（无输入）"}
              </div>
            </div>
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400 transition group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[60vh] w-[420px] overflow-y-auto scrollbar-thin">
          <DropdownMenuLabel>本会话所有运行 · {runs.length} 轮</DropdownMenuLabel>
          {reversed.map((r, i) => {
            const isCurrent = r.requestId === current.requestId;
            const indexFromOldest = runs.indexOf(r) + 1;
            return (
              <DropdownMenuItem
                key={r.requestId}
                onSelect={() => onSelect(r.requestId)}
                icon={isCurrent ? <Check className="h-3.5 w-3.5 text-terra-500" /> : <span className="block h-3.5 w-3.5" />}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-400">
                    {i === 0 ? "最新" : `#${indexFromOldest}`}
                  </span>
                  <span className="truncate text-[12.5px]">{r.input || "（无输入）"}</span>
                </div>
                <span className="ml-2 font-mono text-[10px] text-ink-400">
                  {formatTime(r.startedAt)}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RunStatusBadge({ status }: { status: RunRecord["status"] }): JSX.Element {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-terra-50 px-1.5 py-0.5 text-terra-600">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> live
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brick-50 px-1.5 py-0.5 text-brick-600">
        <XIcon className="h-2.5 w-2.5" /> failed
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-ink-500">
        cancelled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-moss-50 px-1.5 py-0.5 text-moss-600">
      <Check className="h-2.5 w-2.5" /> done
    </span>
  );
}

// ---------- 画布 ----------

function CanvasArea({ run }: { run?: RunRecord }): JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const rf = useReactFlow<Node<StepNodeData>>();
  const steps = run?.steps ?? [];
  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [steps, selectedStepId],
  );

  const { nodes, edges, translateExtent } = useMemo(() => {
    const { nodes, edges } = layoutSteps(steps);
    if (nodes.length === 0) {
      return {
        nodes,
        edges,
        translateExtent: [
          [-1000, -1000],
          [1000, 1000],
        ] as [[number, number], [number, number]],
      };
    }
    // 计算节点包围盒，加 padding 限制平移范围
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + 240); // node width
      maxY = Math.max(maxY, n.position.y + 120); // approx node height
    }
    const padding = 200;
    return {
      nodes,
      edges,
      translateExtent: [
        [minX - padding, minY - padding],
        [maxX + padding, maxY + padding],
      ] as [[number, number], [number, number]],
    };
  }, [steps]);

  // 新节点加入 / 切 run 时自适应
  useEffect(() => {
    if (nodes.length === 0) return;
    const t = window.setTimeout(() => {
      try {
        rf.fitView({ padding: 0.16, duration: 240 });
      } catch {
        /* ignore */
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [steps.length, run?.requestId, rf]);

  useEffect(() => {
    if (!selectedStepId) return;
    if (steps.some((step) => step.id === selectedStepId)) return;
    setSelectedStepId(null);
  }, [selectedStepId, steps]);

  const handleNodeClick = useCallback<NodeMouseHandler<Node<StepNodeData>>>(
    (_, node) => {
      if (node.id === selectedStepId) return;
      startTransition(() => setSelectedStepId(node.id));
    },
    [selectedStepId],
  );

  if (!run || steps.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <EmptyCanvas />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.4}
        maxZoom={1.6}
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        panOnScrollMode={"free" as never}
        zoomOnPinch
        zoomOnScroll={false}
        selectionOnDrag={false}
        onInit={(instance) => instance.fitView({ padding: 0.16 })}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="rgba(28,26,23,0.10)"
        />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className={cn("!rounded-md !border !border-ink-200 !bg-paper-50 !shadow-bubble-ai")}
        />
      </ReactFlow>
      <NodeDetailDrawer step={selectedStep} onClose={() => setSelectedStepId(null)} />
    </div>
  );
}

function EmptyCanvas(): JSX.Element {
  return (
    <div className="flex flex-col items-center px-6 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-paper-200/60">
        <Lightbulb className="h-5 w-5 text-ink-400" />
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
        发送一条消息后，
        <br />
        这里会出现整个思考、决策与工具调用的执行图。
      </p>
      <p className="mt-2 text-[11px] text-ink-400">
        点节点看完整数据 · 拖拽节点 · 滚轮平移 · Ctrl+滚轮缩放
      </p>
    </div>
  );
}
