import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Spinner } from "../ui";
import type { WorkspaceResourceLocator } from "./WorkspaceResourceLocator";

const LazyWorkspaceResourceWorkbench = lazy(() =>
  import("./WorkspaceResourceWorkbench").then((module) => ({ default: module.WorkspaceResourceWorkbench })),
);

export interface WorkspaceResourceController {
  readonly httpBaseUrl: string;
  readonly csrfToken?: string;
  readonly openResource: (locator: WorkspaceResourceLocator) => void;
}

const WorkspaceResourceContext = createContext<WorkspaceResourceController | undefined>(undefined);

export function WorkspaceResourceProvider({
  children,
  csrfToken,
  httpBaseUrl,
}: {
  readonly children: ReactNode;
  readonly csrfToken?: string;
  readonly httpBaseUrl: string;
}): JSX.Element {
  const [activeLocator, setActiveLocator] = useState<WorkspaceResourceLocator>();
  const openResource = useCallback((locator: WorkspaceResourceLocator): void => setActiveLocator(locator), []);
  const controller = useMemo(() => ({ httpBaseUrl, csrfToken, openResource }), [csrfToken, httpBaseUrl, openResource]);

  return (
    <WorkspaceResourceContext.Provider value={controller}>
      {children}
      {activeLocator ? (
        <Suspense fallback={<WorkspaceResourceLoadingFallback />}>
          <LazyWorkspaceResourceWorkbench
            controller={controller}
            locator={activeLocator}
            open
            onOpenChange={(open) => {
              if (!open) setActiveLocator(undefined);
            }}
          />
        </Suspense>
      ) : null}
    </WorkspaceResourceContext.Provider>
  );
}

export function useWorkspaceResourceController(): WorkspaceResourceController | undefined {
  return useContext(WorkspaceResourceContext);
}

function WorkspaceResourceLoadingFallback(): JSX.Element {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[var(--theme-dialog-backdrop)]" role="status">
      <Spinner size="sm" className="text-content-secondary" />
    </div>
  );
}
