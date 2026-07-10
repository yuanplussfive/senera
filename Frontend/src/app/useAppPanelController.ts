import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { readAppShellRenderPlan } from "../layout/AppShell";
import { useStore } from "../store/sessionStore";
import { useResponsiveMode } from "../shared/responsive";

export interface AppPanelController {
  appShellRenderPlan: ReturnType<typeof readAppShellRenderPlan>;
  hasPersistentWorkflowPanel: boolean;
  handleOpenSessionPanel: () => void;
  handleOpenWorkflowPanel: () => void;
  handleToggleSessionPanelShortcut: () => void;
  responsiveMode: ReturnType<typeof useResponsiveMode>;
  sessionDrawerOpen: boolean;
  setSessionDrawerOpen: Dispatch<SetStateAction<boolean>>;
  workflowDrawerOpen: boolean;
  setWorkflowDrawerOpen: Dispatch<SetStateAction<boolean>>;
}

export function useAppPanelController(): AppPanelController {
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const setSidebarCollapsed = useStore((state) => state.setSidebarCollapsed);
  const responsiveMode = useResponsiveMode();
  const { hasPersistentSessionPanel, hasPersistentWorkflowPanel } = responsiveMode;
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const appShellRenderPlan = readAppShellRenderPlan(responsiveMode);

  const handleOpenSessionPanel = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      setSidebarCollapsed(false);
      return;
    }
    setSessionDrawerOpen(true);
  }, [hasPersistentSessionPanel, setSidebarCollapsed]);

  const handleOpenWorkflowPanel = useCallback((): void => {
    setWorkflowDrawerOpen(true);
  }, []);

  const handleToggleSessionPanelShortcut = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      toggleSidebar();
      return;
    }
    setSessionDrawerOpen((open) => !open);
  }, [hasPersistentSessionPanel, toggleSidebar]);

  return {
    appShellRenderPlan,
    hasPersistentWorkflowPanel,
    handleOpenSessionPanel,
    handleOpenWorkflowPanel,
    handleToggleSessionPanelShortcut,
    responsiveMode,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    workflowDrawerOpen,
    setWorkflowDrawerOpen,
  };
}
