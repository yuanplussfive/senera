/** Typed parent/utility-process protocol for the desktop-owned Senera server. */
export const DesktopServerParentMessageKinds = {
  Start: "start",
  Stop: "stop",
} as const;

export const DesktopServerProcessMessageKinds = {
  Ready: "ready",
  WorkspaceOpened: "workspace-opened",
  Stopped: "stopped",
  Failed: "failed",
} as const;

export interface DesktopServerBootstrap {
  readonly workspaceRoot: string;
  readonly applicationStateRoot: string;
  readonly applicationRoot: string;
  readonly resourcesRoot: string;
  readonly upgradeStateRoot: string;
  readonly upgradeDataRoots: readonly string[];
  readonly configPath: string;
  readonly legacyConfigPath: string;
}

export interface DesktopServerSnapshot {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly websocketUrl: string;
  readonly healthUrl: string;
}

export type DesktopServerParentMessage =
  | { readonly kind: typeof DesktopServerParentMessageKinds.Start; readonly bootstrap: DesktopServerBootstrap }
  | { readonly kind: typeof DesktopServerParentMessageKinds.Stop; readonly requestId: string };

export type DesktopServerProcessMessage =
  | { readonly kind: typeof DesktopServerProcessMessageKinds.Ready; readonly snapshot: DesktopServerSnapshot }
  | {
      readonly kind: typeof DesktopServerProcessMessageKinds.WorkspaceOpened;
      readonly workspaceRoot: string;
      readonly workspaceId: string;
    }
  | { readonly kind: typeof DesktopServerProcessMessageKinds.Stopped; readonly requestId: string }
  | {
      readonly kind: typeof DesktopServerProcessMessageKinds.Failed;
      readonly message: string;
      readonly requestId?: string;
    };
