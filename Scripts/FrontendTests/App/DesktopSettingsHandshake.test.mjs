import { expect, test, vi } from "vitest";
import {
  invalidateSettingsSurfaceForReload,
  markSettingsSurfaceReady,
  queueSettingsSection,
} from "../../../Apps/Desktop/DesktopSettingsHandshake.ts";

test("holds a queued section until the settings surface is ready and delivers it once", () => {
  const state = { ready: false, pendingSection: undefined };
  const sendSection = vi.fn();

  queueSettingsSection(state, "appearance", { dirty: false, destroyed: false, sendSection });
  expect(sendSection).not.toHaveBeenCalled();

  markSettingsSurfaceReady(state, { dirty: false, destroyed: false, sendSection });
  markSettingsSurfaceReady(state, { dirty: false, destroyed: false, sendSection });

  expect(sendSection.mock.calls).toEqual([["appearance"]]);
});

test("drops a queued section while settings have unsaved changes instead of replaying it later", () => {
  const state = { ready: true, pendingSection: undefined };
  const sendSection = vi.fn();

  queueSettingsSection(state, "appearance", { dirty: true, destroyed: false, sendSection });
  markSettingsSurfaceReady(state, { dirty: false, destroyed: false, sendSection });

  expect(sendSection).not.toHaveBeenCalled();

  queueSettingsSection(state, "storage", { dirty: false, destroyed: false, sendSection });
  expect(sendSection.mock.calls).toEqual([["storage"]]);
});

test("drops a queued section when the settings window is already gone", () => {
  const state = { ready: false, pendingSection: undefined };
  const sendSection = vi.fn();

  queueSettingsSection(state, "appearance", { dirty: false, destroyed: true, sendSection });
  markSettingsSurfaceReady(state, { dirty: false, destroyed: true, sendSection });
  markSettingsSurfaceReady(state, { dirty: false, destroyed: false, sendSection });

  expect(sendSection).not.toHaveBeenCalled();
});

test("clears queued navigation when the renderer reloads", () => {
  const state = { ready: false, pendingSection: undefined };
  const sendSection = vi.fn();

  queueSettingsSection(state, "appearance", { dirty: false, destroyed: false, sendSection });
  invalidateSettingsSurfaceForReload(state);
  markSettingsSurfaceReady(state, { dirty: false, destroyed: false, sendSection });

  // The queued request belonged to the document that reloaded; the fresh one
  // must only navigate when the user asks again.
  expect(sendSection).not.toHaveBeenCalled();
});
