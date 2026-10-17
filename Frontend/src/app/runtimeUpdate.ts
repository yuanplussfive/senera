import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternalUrl, readDesktopBridge, type DesktopUpdateSnapshot } from "./desktopBridge";

export type RuntimeUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "downloaded"
  | "not-configured"
  | "unavailable"
  | "error";

export interface RuntimeUpdateSnapshot {
  state: RuntimeUpdateState;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  deployment?: "local" | "container";
  action: "none" | "reload" | "operator" | "download" | "install";
  percent?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface RuntimeUpdateController {
  snapshot: RuntimeUpdateSnapshot;
  check: () => Promise<void>;
  apply: () => Promise<void>;
  openRelease: () => Promise<void>;
}

export function useRuntimeUpdate({
  httpBaseUrl,
  currentVersion,
  surface,
}: {
  httpBaseUrl: string;
  currentVersion: string;
  surface: "desktop" | "web";
}): RuntimeUpdateController {
  const bridge = useMemo(() => readDesktopBridge(), []);
  const [snapshot, setSnapshot] = useState<RuntimeUpdateSnapshot>(() => ({
    state: "idle",
    currentVersion,
    action: "none",
  }));

  const ingestDesktopSnapshot = useCallback((value: DesktopUpdateSnapshot | undefined): void => {
    if (!value) return;
    setSnapshot({
      state: mapDesktopState(value.state),
      currentVersion: value.currentVersion,
      availableVersion: value.availableVersion,
      releaseName: value.releaseName,
      action: value.state === "available" ? "download" : value.state === "downloaded" ? "install" : "none",
      percent: value.percent,
      errorCode: value.errorCode,
      errorMessage: value.errorMessage,
    });
  }, []);

  useEffect(() => {
    if (surface !== "desktop" || !bridge?.isDesktop) return;
    let active = true;
    const initialState = bridge.getUpdateState?.();
    if (initialState) {
      void initialState
        .then((value) => {
          if (active) ingestDesktopSnapshot(value);
        })
        .catch(() => undefined);
    }
    const unsubscribe = bridge.onUpdateStateChanged?.((value) => {
      if (active) ingestDesktopSnapshot(value);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge, ingestDesktopSnapshot, surface]);

  const check = useCallback(async (): Promise<void> => {
    if (surface === "desktop" && bridge?.isDesktop) {
      ingestDesktopSnapshot(await bridge.checkForUpdates?.());
      return;
    }

    setSnapshot((value) => ({ ...value, state: "checking", errorMessage: undefined }));
    try {
      const response = await fetch(`${httpBaseUrl.replace(/\/$/u, "")}/api/runtime-update?refresh=1`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Update status request failed: HTTP ${response.status}.`);
      const payload = (await response.json()) as RuntimeUpdateApiResponse;
      setSnapshot(projectRuntimeUpdateSnapshot(payload));
    } catch (error) {
      setSnapshot((value) => ({
        ...value,
        state: "unavailable",
        action: "none",
        errorCode: "request_failed",
        errorMessage: error instanceof Error ? error.message : undefined,
      }));
    }
  }, [bridge, httpBaseUrl, ingestDesktopSnapshot, surface]);

  const apply = useCallback(async (): Promise<void> => {
    if (surface === "desktop" && bridge?.isDesktop) {
      if (snapshot.state === "available") ingestDesktopSnapshot(await bridge.downloadUpdate?.());
      else if (snapshot.state === "downloaded") ingestDesktopSnapshot(await bridge.installUpdate?.());
      return;
    }
    if (snapshot.action === "reload") window.location.reload();
    else if (snapshot.action === "operator" && snapshot.releaseUrl) {
      await openExternalUrl(snapshot.releaseUrl, { bridge: bridge ?? undefined });
    }
  }, [bridge, ingestDesktopSnapshot, snapshot.action, snapshot.releaseUrl, snapshot.state, surface]);

  const openRelease = useCallback(async (): Promise<void> => {
    if (!snapshot.releaseUrl) return;
    await openExternalUrl(snapshot.releaseUrl, { bridge: bridge ?? undefined });
  }, [bridge, snapshot.releaseUrl]);

  return { snapshot, check, apply, openRelease };
}

interface RuntimeUpdateApiResponse {
  currentVersion?: unknown;
  deployment?: unknown;
  status?: unknown;
  action?: unknown;
  diagnostic?: { code?: unknown };
  latest?: {
    version?: unknown;
    releaseName?: unknown;
    releaseUrl?: unknown;
  };
}

function projectRuntimeUpdateSnapshot(value: RuntimeUpdateApiResponse): RuntimeUpdateSnapshot {
  const state = isRuntimeUpdateState(value.status) ? value.status : "unavailable";
  const latestVersion = text(value.latest?.version);
  return {
    state,
    currentVersion: text(value.currentVersion) ?? "0.0.0",
    availableVersion: latestVersion,
    releaseName: text(value.latest?.releaseName),
    releaseUrl: text(value.latest?.releaseUrl),
    deployment: value.deployment === "container" ? "container" : "local",
    action: isRuntimeUpdateAction(value.action) ? value.action : "none",
    errorCode: text(value.diagnostic?.code),
  };
}

function mapDesktopState(state: DesktopUpdateSnapshot["state"]): RuntimeUpdateState {
  if (state === "not-available") return "up-to-date";
  if (state === "error") return "error";
  if (state === "unsupported") return "not-configured";
  return state;
}

function isRuntimeUpdateState(value: unknown): value is RuntimeUpdateState {
  return [
    "not-configured",
    "checking",
    "up-to-date",
    "available",
    "unavailable",
    "downloading",
    "downloaded",
    "error",
  ].includes(value as RuntimeUpdateState);
}

function isRuntimeUpdateAction(value: unknown): value is RuntimeUpdateSnapshot["action"] {
  return ["none", "reload", "operator", "download", "install"].includes(value as string);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
