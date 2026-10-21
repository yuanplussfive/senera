export interface SettingsSurfaceReadinessState {
  ready: boolean;
  pendingSection?: string;
}

export interface SettingsSurfaceDeliveryOptions {
  readonly dirty: boolean;
  readonly destroyed: boolean;
  readonly sendSection: (section: string) => void;
}

/**
 * A renderer reload (chunk mismatch recovery, crash restore) starts a new document
 * whose section listener is not registered yet. Both the readiness handshake and
 * any queued request belong to the old document, so neither may survive it.
 */
export function invalidateSettingsSurfaceForReload(state: SettingsSurfaceReadinessState): void {
  state.ready = false;
  state.pendingSection = undefined;
}

export function markSettingsSurfaceReady(
  state: SettingsSurfaceReadinessState,
  options: SettingsSurfaceDeliveryOptions,
): void {
  state.ready = true;
  deliverQueuedSettingsSection(state, options);
}

export function queueSettingsSection(
  state: SettingsSurfaceReadinessState,
  section: string,
  options: SettingsSurfaceDeliveryOptions,
): void {
  state.pendingSection = section;
  deliverQueuedSettingsSection(state, options);
}

/**
 * Delivers at most one queued section. A request that cannot be honoured now is
 * dropped instead of kept: replaying it later would navigate a surface the user
 * has since changed focus away from.
 */
export function deliverQueuedSettingsSection(
  state: SettingsSurfaceReadinessState,
  options: SettingsSurfaceDeliveryOptions,
): void {
  const section = state.pendingSection;
  if (!section || !state.ready) return;
  state.pendingSection = undefined;
  if (options.dirty || options.destroyed) return;
  options.sendSection(section);
}
