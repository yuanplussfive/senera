import { expect, test, vi } from "vitest";
import {
  desktopSettingsSectionRequestChannel,
  focusExistingSettingsWindow,
} from "../../../Apps/Desktop/DesktopSettingsWindow.ts";

test("focuses an existing clean settings window without reloading it", () => {
  const settings = settingsWindow({ minimized: true });

  focusExistingSettingsWindow(settings.window, "appearance", false);

  expect(settings.restore).toHaveBeenCalledTimes(1);
  expect(settings.focus).toHaveBeenCalledTimes(1);
  expect(settings.webContents.send).toHaveBeenCalledWith(desktopSettingsSectionRequestChannel, "appearance");
});

test("does not switch the section while settings have pending changes", () => {
  const settings = settingsWindow();

  focusExistingSettingsWindow(settings.window, "appearance", true);

  expect(settings.focus).toHaveBeenCalledTimes(1);
  expect(settings.webContents.send).not.toHaveBeenCalled();
});

function settingsWindow({ minimized = false } = {}) {
  const restore = vi.fn();
  const focus = vi.fn();
  const send = vi.fn();
  return {
    restore,
    focus,
    webContents: { send },
    window: {
      isMinimized: () => minimized,
      restore,
      focus,
      webContents: { send },
    },
  };
}
