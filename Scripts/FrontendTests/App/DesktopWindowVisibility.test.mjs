import { expect, test, vi } from "vitest";
import {
  hideDesktopWindows,
  showDesktopWindows,
} from "../../../Apps/Desktop/DesktopWindowVisibility.ts";

test("desktop close hides every live window without destroying it", () => {
  const main = visibilityWindow();
  const settings = visibilityWindow();
  const destroyed = visibilityWindow({ destroyed: true });

  hideDesktopWindows([main.window, settings.window, destroyed.window]);

  expect(main.hide).toHaveBeenCalledTimes(1);
  expect(settings.hide).toHaveBeenCalledTimes(1);
  expect(destroyed.hide).not.toHaveBeenCalled();
});

test("desktop restore shows all live windows and focuses the last surface", () => {
  const main = visibilityWindow({ minimized: true });
  const settings = visibilityWindow();

  showDesktopWindows([main.window, settings.window]);

  expect(main.restore).toHaveBeenCalledTimes(1);
  expect(main.show).toHaveBeenCalledTimes(1);
  expect(main.focus).not.toHaveBeenCalled();
  expect(settings.show).toHaveBeenCalledTimes(1);
  expect(settings.focus).toHaveBeenCalledTimes(1);
});

function visibilityWindow({ destroyed = false, minimized = false } = {}) {
  const hide = vi.fn();
  const restore = vi.fn();
  const show = vi.fn();
  const focus = vi.fn();
  return {
    hide,
    restore,
    show,
    focus,
    window: {
      isDestroyed: () => destroyed,
      isMinimized: () => minimized,
      hide,
      restore,
      show,
      focus,
    },
  };
}
