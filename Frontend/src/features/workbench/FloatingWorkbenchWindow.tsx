import { Maximize2, Minimize2, Minus, PanelTopOpen, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Rnd, type HandleStyles } from "react-rnd";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { IconButton } from "../../shared/ui";
import { useMotionLevel } from "../../shared/motion";
import { useViewportSize } from "../../shared/responsive/useViewportSize";
import { cn } from "../../lib/util";
import {
  clampWindowGeometry,
  createCollapsedWindowGeometry,
  createDefaultWindowGeometry,
  createMaximizedWindowGeometry,
  type WorkbenchWindowGeometry,
  type WorkbenchWindowGeometryPolicy,
  type WorkbenchWindowMode,
} from "./windowGeometry";

const DragHandleClassName = "workbench-window-drag-handle";
const InteractiveSelector =
  "button, a, input, textarea, select, [role='button'], [role='tab'], [data-workbench-interactive]";
const ResizeHandleThickness = 10;
const ResizeCornerSize = 18;

const ResizeHandleStyles: HandleStyles = {
  top: { height: ResizeHandleThickness, top: -ResizeHandleThickness / 2 },
  right: { right: -ResizeHandleThickness / 2, width: ResizeHandleThickness },
  bottom: { bottom: -ResizeHandleThickness / 2, height: ResizeHandleThickness },
  left: { left: -ResizeHandleThickness / 2, width: ResizeHandleThickness },
  topLeft: {
    height: ResizeCornerSize,
    left: -ResizeHandleThickness / 2,
    top: -ResizeHandleThickness / 2,
    width: ResizeCornerSize,
  },
  topRight: {
    height: ResizeCornerSize,
    right: -ResizeHandleThickness / 2,
    top: -ResizeHandleThickness / 2,
    width: ResizeCornerSize,
  },
  bottomLeft: {
    bottom: -ResizeHandleThickness / 2,
    height: ResizeCornerSize,
    left: -ResizeHandleThickness / 2,
    width: ResizeCornerSize,
  },
  bottomRight: {
    bottom: -ResizeHandleThickness / 2,
    height: ResizeCornerSize,
    right: -ResizeHandleThickness / 2,
    width: ResizeCornerSize,
  },
};

const ArrowDeltas = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
} as const;

export interface FloatingWorkbenchWindowProps {
  open: boolean;
  compact: boolean;
  mode: WorkbenchWindowMode;
  title: string;
  meta?: ReactNode;
  icon?: ReactNode;
  titlebarContent?: ReactNode;
  appearance?: WorkbenchWindowAppearance;
  surfaceStyle?: CSSProperties;
  children: ReactNode;
  geometry?: WorkbenchWindowGeometry;
  geometryPolicy: WorkbenchWindowGeometryPolicy;
  onClose: () => void;
  onModeChange: (mode: WorkbenchWindowMode) => void;
  onGeometryCommit: (geometry: WorkbenchWindowGeometry) => void;
}

export type WorkbenchWindowAppearance = "default" | "terminal";

const WindowAppearanceStyles = {
  default: {
    surface: "border-ink-300/90 bg-paper-50",
    titlebar: "border-ink-200/90 bg-paper-50",
    identityIcon: "bg-ink-900 text-paper-50",
    title: "text-ink-900",
    meta: "text-ink-400",
    control: "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
    closeControl: "text-ink-500 hover:bg-brick-50 hover:text-brick-700",
  },
  terminal: {
    surface: "border-[var(--terminal-border)] bg-[var(--terminal-canvas)]",
    titlebar: "border-[var(--terminal-separator)] bg-[var(--terminal-chrome)]",
    identityIcon: "bg-transparent text-[var(--terminal-muted)]",
    title: "text-[var(--terminal-foreground)]",
    meta: "text-[var(--terminal-muted)]",
    control: "text-[var(--terminal-muted)] hover:bg-white/[0.07] hover:text-[var(--terminal-foreground)]",
    closeControl: "text-[var(--terminal-muted)] hover:bg-brick-900/70 hover:text-brick-100",
  },
} as const satisfies Record<WorkbenchWindowAppearance, Record<string, string>>;

export function FloatingWorkbenchWindow(props: FloatingWorkbenchWindowProps): JSX.Element | null {
  const viewport = useViewportSize();
  const { reduceMotion, disableMotion } = useMotionLevel();
  const initialGeometry = useMemo(
    () =>
      clampWindowGeometry(
        props.geometry ?? createDefaultWindowGeometry(viewport, props.geometryPolicy),
        viewport,
        props.geometryPolicy,
      ),
    [props.geometry, props.geometryPolicy, viewport],
  );
  const [normalGeometry, setNormalGeometry] = useState(initialGeometry);

  useEffect(() => {
    setNormalGeometry(initialGeometry);
  }, [initialGeometry]);

  const displayGeometry = resolveDisplayGeometry(
    normalGeometry,
    props.mode,
    viewport,
    props.geometryPolicy,
    props.compact,
  );
  const collapsed = props.mode === "collapsed";
  const effectivelyMaximized = props.mode === "maximized" || (props.compact && !collapsed);
  const resizable = !props.compact && props.mode === "normal";
  const draggable = !props.compact && props.mode !== "maximized";
  const boundsInset = props.compact && !collapsed ? props.geometryPolicy.compactInset : props.geometryPolicy.inset;
  const appearance = WindowAppearanceStyles[props.appearance ?? "default"];

  if (!props.open) return null;

  const commitNormalGeometry = (geometry: WorkbenchWindowGeometry): void => {
    const next = clampWindowGeometry(geometry, viewport, props.geometryPolicy);
    setNormalGeometry(next);
    props.onGeometryCommit(next);
  };

  const handleTitlebarKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const direction = ArrowDeltas[event.key as keyof typeof ArrowDeltas];
    if (!event.altKey || !direction || effectivelyMaximized || event.currentTarget !== event.target) return;
    event.preventDefault();
    const step = props.geometryPolicy.keyboardStep;
    const next =
      event.shiftKey && !collapsed
        ? {
            ...normalGeometry,
            width: normalGeometry.width + direction.x * step,
            height: normalGeometry.height + direction.y * step,
          }
        : { ...normalGeometry, x: normalGeometry.x + direction.x * step, y: normalGeometry.y + direction.y * step };
    commitNormalGeometry(next);
  };

  return (
    <Rnd
      bounds="parent"
      position={{ x: displayGeometry.x, y: displayGeometry.y }}
      size={{ width: displayGeometry.width, height: displayGeometry.height }}
      minWidth={collapsed ? displayGeometry.width : Math.min(props.geometryPolicy.minWidth, viewport.width)}
      minHeight={
        collapsed ? props.geometryPolicy.titlebarHeight : Math.min(props.geometryPolicy.minHeight, viewport.height)
      }
      maxWidth={Math.max(1, viewport.width - boundsInset * 2)}
      maxHeight={Math.max(1, viewport.height - boundsInset * 2)}
      dragHandleClassName={DragHandleClassName}
      cancel={InteractiveSelector}
      disableDragging={!draggable}
      enableResizing={resizable}
      resizeHandleStyles={ResizeHandleStyles}
      resizeHandleComponent={{
        bottomRight: (
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-ink-400/70"
          />
        ),
      }}
      onDrag={(_event, data) => {
        setNormalGeometry((current) => ({ ...current, x: data.x, y: data.y }));
      }}
      onDragStop={(_event, data) => {
        commitNormalGeometry({ ...normalGeometry, x: data.x, y: data.y });
      }}
      onResize={(_event, _direction, element, _delta, position) => {
        setNormalGeometry({ x: position.x, y: position.y, width: element.offsetWidth, height: element.offsetHeight });
      }}
      onResizeStop={(_event, _direction, element, _delta, position) => {
        commitNormalGeometry({
          x: position.x,
          y: position.y,
          width: element.offsetWidth,
          height: element.offsetHeight,
        });
      }}
      className="pointer-events-auto"
      style={{ ...props.surfaceStyle, zIndex: 1 }}
    >
      <motion.section
        role="region"
        aria-label={props.title}
        initial={disableMotion ? false : { opacity: 0, scale: reduceMotion ? 1 : 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={disableMotion ? { duration: 0 } : { duration: reduceMotion ? 0.1 : 0.16, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "flex h-full w-full flex-col overflow-hidden rounded-md border",
          appearance.surface,
          "shadow-[0_22px_70px_rgba(20,23,21,0.2),0_2px_10px_rgba(20,23,21,0.12)]",
        )}
      >
        <div
          className={cn(
            DragHandleClassName,
            "flex h-10 shrink-0 select-none items-center gap-2 border-b px-2.5",
            appearance.titlebar,
            draggable ? "cursor-move" : "cursor-default",
            "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300/70",
          )}
          tabIndex={draggable ? 0 : -1}
          onKeyDown={handleTitlebarKeyDown}
          onDoubleClick={(event) => {
            if (props.compact || collapsed || (event.target as Element).closest(InteractiveSelector)) return;
            props.onModeChange(props.mode === "maximized" ? "normal" : "maximized");
          }}
        >
          {props.titlebarContent ? (
            <div className="min-w-0 flex-1 self-stretch">{props.titlebarContent}</div>
          ) : (
            <>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-[4px]", appearance.identityIcon)}>
                {props.icon}
              </span>
              <span className={cn("min-w-0 truncate text-[12.5px] font-medium", appearance.title)}>{props.title}</span>
              {props.meta ? (
                <span className={cn("min-w-0 flex-1 truncate text-[11px]", appearance.meta)}>{props.meta}</span>
              ) : (
                <span className="flex-1" />
              )}
            </>
          )}
          <div className="flex shrink-0 items-center gap-0.5" data-workbench-interactive>
            <IconButton
              label={frontendMessage(collapsed ? "workbench.window.restore" : "workbench.window.collapse")}
              tooltip={frontendMessage(collapsed ? "workbench.window.restore" : "workbench.window.collapse")}
              onClick={() => props.onModeChange(collapsed ? "normal" : "collapsed")}
              className={cn("h-7 w-7", appearance.control)}
            >
              {collapsed ? <PanelTopOpen className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </IconButton>
            {!props.compact && !collapsed ? (
              <IconButton
                label={frontendMessage(effectivelyMaximized ? "workbench.window.restore" : "workbench.window.maximize")}
                tooltip={frontendMessage(
                  effectivelyMaximized ? "workbench.window.restore" : "workbench.window.maximize",
                )}
                onClick={() => props.onModeChange(effectivelyMaximized ? "normal" : "maximized")}
                className={cn("h-7 w-7", appearance.control)}
              >
                {effectivelyMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </IconButton>
            ) : null}
            <IconButton
              label={frontendMessage("workbench.window.close")}
              tooltip={frontendMessage("workbench.window.close")}
              onClick={props.onClose}
              className={cn("h-7 w-7", appearance.closeControl)}
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
        {collapsed ? null : <div className="min-h-0 flex-1">{props.children}</div>}
      </motion.section>
    </Rnd>
  );
}

function resolveDisplayGeometry(
  normalGeometry: WorkbenchWindowGeometry,
  mode: WorkbenchWindowMode,
  viewport: ReturnType<typeof useViewportSize>,
  policy: WorkbenchWindowGeometryPolicy,
  compact: boolean,
): WorkbenchWindowGeometry {
  if (mode === "collapsed") return createCollapsedWindowGeometry(normalGeometry, viewport, policy);
  if (mode === "maximized" || compact) return createMaximizedWindowGeometry(viewport, policy, compact);
  return clampWindowGeometry(normalGeometry, viewport, policy);
}
