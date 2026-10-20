import { expect, test, vi } from "vitest";
import { hideDesktopWindows, showDesktopWindows } from "../../../Apps/Desktop/DesktopWindowVisibility.ts";

test("desktop close hides every live window without destroying it", () => {
  const main = visibilityWindow();
  const settings = visibilityWindow();
  const destroyed = visibilityWindow({ destroyed: true });

  hideDesktopWindows([main.window, settings.window, destroyed.window]);

  expect(main.hide).toHaveBeenCalledTimes(1);
  expect(settings.hide).toHaveBeenCalledTimes(1);
  expect(destroyed.hide).not.toHaveBeenCalled();
});

test("desktop restore shows live windows without changing the active surface", () => {
  const main = visibilityWindow({ minimized: true });
  const settings = visibilityWindow();

  showDesktopWindows([main.window, settings.window]);

  expect(main.restore).toHaveBeenCalledTimes(1);
  expect(main.showInactive).toHaveBeenCalledTimes(1);
  expect(main.focus).not.toHaveBeenCalled();
  expect(settings.showInactive).toHaveBeenCalledTimes(1);
  expect(settings.focus).not.toHaveBeenCalled();
});

test("desktop restore can focus an explicitly requested window", () => {
  const main = visibilityWindow();
  const settings = visibilityWindow();

  showDesktopWindows([main.window, settings.window], main.window);

  expect(main.show).toHaveBeenCalledTimes(1);
  expect(main.focus).toHaveBeenCalledTimes(1);
  expect(settings.showInactive).toHaveBeenCalledTimes(1);
  expect(settings.focus).not.toHaveBeenCalled();
});

function visibilityWindow({ destroyed = false, minimized = false } = {}) {
  const hide = vi.fn();
  const restore = vi.fn();
  const show = vi.fn();
  const showInactive = vi.fn();
  const focus = vi.fn();
  return {
    hide,
    restore,
    show,
    showInactive,
    focus,
    window: {
      isDestroyed: () => destroyed,
      isMinimized: () => minimized,
      isVisible: () => false,
      hide,
      restore,
      show,
      showInactive,
      focus,
    },
  };
}
