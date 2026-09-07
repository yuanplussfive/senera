import type { AppSurface } from "./appSurface";
import { createRecoverableModuleLoader } from "../lib/createRecoverableModuleLoader";

const loadMainApplicationModule = createRecoverableFrontendModuleLoader(() => import("../App"));
const loadDesktopSettingsSurfaceModule = createRecoverableFrontendModuleLoader(
  () => import("./DesktopSettingsSurface"),
);
const loadWebSettingsOverlayModule = createRecoverableFrontendModuleLoader(
  () => import("../features/settings/SettingsOverlay"),
);
const loadEventJournalRecorderModule = createRecoverableFrontendModuleLoader(
  () => import("../features/observability/eventJournalRecorder"),
);

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
  observeSpeculativeLoad(routeModule());
}

export function prepareAuthenticatedApplication(surface: AppSurface): Promise<void> {
  const routeModule = surface === "settings" ? loadDesktopSettingsSurfaceModule : loadMainApplicationModule;
  // Observability is helpful but must never delay the first authenticated surface.
  observeSpeculativeLoad(prepareEventJournalRecorder());
  return routeModule().then(() => undefined);
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
    await recorder.installEventJournalRecorder();
  } catch {
    // Optional diagnostics must not prevent an authorized application surface from loading.
  }
}

function createRecoverableFrontendModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
  return createRecoverableModuleLoader(load);
}
