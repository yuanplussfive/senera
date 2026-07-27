import type { AppSurface } from "./appSurface";
import { createRecoverableModuleLoader } from "../lib/createRecoverableModuleLoader";

const loadAuthenticatedSurfaceModule = createRecoverableModuleLoader(() => import("./AuthenticatedSurface"));
const loadMainApplicationModule = createRecoverableModuleLoader(() => import("../App"));
const loadDesktopSettingsSurfaceModule = createRecoverableModuleLoader(() => import("./DesktopSettingsSurface"));
const loadWebSettingsOverlayModule = createRecoverableModuleLoader(
  () => import("../features/settings/SettingsOverlay"),
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
  observeSpeculativeLoad(prepareAuthenticatedApplication(surface));
}

export function prepareAuthenticatedApplication(surface: AppSurface): Promise<void> {
  const routeModule = surface === "settings" ? loadDesktopSettingsSurfaceModule : loadMainApplicationModule;
  return Promise.all([loadAuthenticatedSurfaceModule(), routeModule()]).then(() => undefined);
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
