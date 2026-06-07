import { motion, type Transition } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent } from "../../shared/ui";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { useStore } from "../../store/sessionStore";

const SESSION_RAIL_WIDTH = 56;
const SESSION_PANEL_WIDTH = 264;
const WORKFLOW_RAIL_WIDTH = 44;
const WORKFLOW_PANEL_WIDTH = 460;

interface AppShellProps {
  sessionRail: ReactNode;
  sessionPanel: ReactNode;
  sessionDrawer: ReactNode;
  chatPanel: ReactNode;
  workflowPanel: ReactNode;
  workflowDrawer: ReactNode;
  sessionDrawerOpen: boolean;
  onSessionDrawerOpenChange: (open: boolean) => void;
  workflowDrawerOpen: boolean;
  onWorkflowDrawerOpenChange: (open: boolean) => void;
}

export function AppShell({
  sessionRail,
  sessionPanel,
  sessionDrawer,
  chatPanel,
  workflowPanel,
  workflowDrawer,
  sessionDrawerOpen,
  onSessionDrawerOpenChange,
  workflowDrawerOpen,
  onWorkflowDrawerOpenChange,
}: AppShellProps): JSX.Element {
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const rightPanelCollapsed = useStore((state) => state.rightPanelCollapsed);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const panelResizeTransition: Transition =
    disableMotion || reduceMotion ? { duration: 0 } : motionTimings.slow;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden text-ink-900">
      <div className="hidden md:flex xl:hidden">{sessionRail}</div>
      <motion.div
        initial={false}
        animate={{ width: sidebarCollapsed ? SESSION_RAIL_WIDTH : SESSION_PANEL_WIDTH }}
        transition={panelResizeTransition}
        className="hidden h-full shrink-0 overflow-hidden xl:flex"
      >
        {sessionPanel}
      </motion.div>
      <div className="flex min-w-0 flex-1">{chatPanel}</div>
      <motion.div
        initial={false}
        animate={{ width: rightPanelCollapsed ? WORKFLOW_RAIL_WIDTH : WORKFLOW_PANEL_WIDTH }}
        transition={panelResizeTransition}
        className="hidden h-full shrink-0 overflow-hidden lg:flex"
      >
        {workflowPanel}
      </motion.div>

      <Sheet open={sessionDrawerOpen} onOpenChange={onSessionDrawerOpenChange}>
        <SheetContent side="left" title="会话" className="w-[min(360px,calc(100vw-24px))] p-0">
          <div className="min-h-0 flex-1">{sessionDrawer}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={workflowDrawerOpen} onOpenChange={onWorkflowDrawerOpenChange}>
        <SheetContent side="right" title="思考过程" className="w-[min(560px,calc(100vw-24px))] p-0">
          <div className="min-h-0 flex-1">{workflowDrawer}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function useMediaQuery(query: string): boolean {
  const getInitialValue = (): boolean =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false;
  const [matches, setMatches] = useState(getInitialValue);

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (): void => setMatches(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
