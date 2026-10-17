export const desktopSettingsSectionRequestChannel = "senera:settings.section-requested";

export interface ExistingSettingsWindow {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  webContents: {
    send(channel: string, section: string): void;
  };
}

export function focusExistingSettingsWindow(
  window: ExistingSettingsWindow,
  section: string,
  hasPendingChanges: boolean,
): void {
  if (window.isMinimized()) window.restore();
  window.focus();
  if (!hasPendingChanges) {
    window.webContents.send(desktopSettingsSectionRequestChannel, section);
  }
}
