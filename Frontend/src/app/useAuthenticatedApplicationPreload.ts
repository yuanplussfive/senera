import { useCallback, useEffect } from "react";
import { scheduleIdleTask } from "../shared/scheduling/scheduleIdleTask";
import type { AppSurface } from "./appSurface";
import { prepareAuthenticatedApplication, preloadAuthenticatedApplication } from "./applicationModuleLoaders";

export interface AuthenticatedApplicationPreloadLifecycle {
  onInitialAuthenticationRequestStarted: () => void;
  prepareAuthorizedSurface: () => Promise<void>;
}

export function useAuthenticatedApplicationPreload({
  isDesktop,
  surface,
}: {
  isDesktop: boolean;
  surface: AppSurface;
}): AuthenticatedApplicationPreloadLifecycle {
  const preload = useCallback(() => preloadAuthenticatedApplication(surface), [surface]);

  useEffect(() => {
    if (isDesktop) return;
    return scheduleIdleTask(preload, { priority: "background" });
  }, [isDesktop, preload]);

  return {
    onInitialAuthenticationRequestStarted: useCallback(() => {
      if (isDesktop) preload();
    }, [isDesktop, preload]),
    prepareAuthorizedSurface: useCallback(() => prepareAuthenticatedApplication(surface), [surface]),
  };
}
