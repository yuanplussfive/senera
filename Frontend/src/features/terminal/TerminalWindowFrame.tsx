import { SquareTerminal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useResponsiveMode } from "../../shared/responsive";
import { FloatingWorkbenchWindow } from "../workbench/FloatingWorkbenchWindow";
import { useWorkbenchStore } from "../workbench/workbenchStore";
import type { WorkbenchWindowGeometryPolicy, WorkbenchWindowMode } from "../workbench/windowGeometry";
import { TerminalSurfaceStyle } from "./terminalPresentation";

const TerminalWindowGeometryPolicy = {
  inset: 12,
  compactInset: 0,
  defaultWidth: 720,
  defaultHeight: 440,
  defaultLeft: 64,
  defaultTop: 64,
  minWidth: 480,
  minHeight: 280,
  collapsedWidth: 360,
  titlebarHeight: 40,
  keyboardStep: 16,
} as const satisfies WorkbenchWindowGeometryPolicy;

export function TerminalWindowFrame(props: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceCount?: number;
  titlebarContent?: ReactNode;
}): JSX.Element | null {
  const responsiveMode = useResponsiveMode();
  const placement = useWorkbenchStore((state) => state.windowPlacements.terminal);
  const setWindowPlacement = useWorkbenchStore((state) => state.setWindowPlacement);
  const [mode, setMode] = useState<WorkbenchWindowMode>("normal");

  return (
    <FloatingWorkbenchWindow
      open={props.open}
      compact={responsiveMode.viewport === "mobile"}
      mode={mode}
      title={frontendMessage("terminal.panel.title")}
      titlebarContent={props.titlebarContent}
      appearance="terminal"
      surfaceStyle={TerminalSurfaceStyle}
      meta={
        props.resourceCount === undefined
          ? undefined
          : frontendMessage("terminal.panel.description", { count: props.resourceCount })
      }
      icon={<SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />}
      geometry={placement}
      geometryPolicy={TerminalWindowGeometryPolicy}
      onGeometryCommit={(geometry) => setWindowPlacement("terminal", geometry)}
      onModeChange={setMode}
      onClose={() => {
        setMode("normal");
        props.onOpenChange(false);
      }}
    >
      {props.children}
    </FloatingWorkbenchWindow>
  );
}
