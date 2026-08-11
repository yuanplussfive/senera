import type { AppSurface } from "./appSurface";
import { createRecoverableModuleLoader } from "../lib/createRecoverableModuleLoader";

type AuthenticatedSurfaceModule = typeof import("./AuthenticatedSurface");

const loadAuthenticatedSurfaceModule = createRecoverableModuleLoader<AuthenticatedSurfaceModule>(
  async (retryAttempt) => {
    if (retryAttempt === 0) return import("./AuthenticatedSurface");
    const moduleUrl = await resolveAuthenticatedSurfaceModuleUrl();
    return import(
      /* @vite-ignore */ `${moduleUrl}?senera-retry=${retryAttempt}`
    ) as Promise<AuthenticatedSurfaceModule>;
  },
);
const loadMainApplicationModule = createRecoverableModuleLoader(() => import("../App"));
const loadDesktopSettingsSurfaceModule = createRecoverableModuleLoader(() => import("./DesktopSettingsSurface"));
const loadWebSettingsOverlayModule = createRecoverableModuleLoader(
  () => import("../features/settings/SettingsOverlay"),
);
const loadEventJournalRecorderModule = createRecoverableModuleLoader(
  () => import("../features/observability/eventJournalRecorder"),
);

export function loadAuthenticatedSurfaceComponent() {
  return loadAuthenticatedSurfaceModule().then(({ AuthenticatedSurface }) => ({ default: AuthenticatedSurface }));
}

export function loadMainApplicationComponent() {
  return loadMainApplicationModule().then(({ App }) => ({ default: App }));
}

export function loadDesktopSettingsSurfaceComponent() {
  return loadDesktopSettingsSurfaceModule().then(({ DesktopSettingsSurface }) => ({
    default: DesktopSettingsSurface,
  }));
}

export function loadWebSettingsOverlayComponent() {
  return loadWebSettingsOverlayModule().then(({ SettingsOverlay }) => ({ default: SettingsOverlay }));
}

export function preloadAuthenticatedApplication(surface: AppSurface): void {
  const routeModule = surface === "settings" ? loadDesktopSettingsSurfaceModule : loadMainApplicationModule;
  observeSpeculativeLoad(Promise.all([loadAuthenticatedSurfaceModule(), routeModule()]).then(() => undefined));
}

export function prepareAuthenticatedApplication(surface: AppSurface): Promise<void> {
  const routeModule = surface === "settings" ? loadDesktopSettingsSurfaceModule : loadMainApplicationModule;
  return Promise.all([loadAuthenticatedSurfaceModule(), routeModule(), prepareEventJournalRecorder()]).then(
    () => undefined,
  );
}

export function preloadWebSettingsSurface(): void {
  observeSpeculativeLoad(prepareWebSettingsSurface());
}

export function prepareWebSettingsSurface(): Promise<void> {
  return loadWebSettingsOverlayModule().then(() => undefined);
}

function observeSpeculativeLoad(load: Promise<unknown>): void {
  void load.catch(() => undefined);
}

async function prepareEventJournalRecorder(): Promise<void> {
  try {
    const recorder = await loadEventJournalRecorderModule();
    recorder.installEventJournalRecorder();
  } catch {
    // Optional diagnostics must not prevent an authorized application surface from loading.
  }
}

async function resolveAuthenticatedSurfaceModuleUrl(): Promise<string> {
  if (import.meta.env.DEV) {
    return new URL(/* @vite-ignore */ "./AuthenticatedSurface.tsx", import.meta.url).href;
  }

  const manifestUrl = new URL(/* @vite-ignore */ "../.vite/manifest.json", import.meta.url);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to read the frontend asset manifest (${response.status}).`);

  const manifest = (await response.json()) as Record<string, { file?: string }>;
  const file = manifest["src/app/AuthenticatedSurface.tsx"]?.file;
  if (!file) throw new Error("AuthenticatedSurface is missing from the frontend asset manifest.");
  return new URL(/* @vite-ignore */ `../${file}`, import.meta.url).href;
}
