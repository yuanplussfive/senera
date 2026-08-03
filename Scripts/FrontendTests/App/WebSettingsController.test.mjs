import React, { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSettingsController } from "../../../Frontend/src/app/useWebSettingsController.ts";
import { settingsHistoryStateKey } from "../../../Frontend/src/app/appSurface.ts";

let controller;
let prepareSurface;

function ControllerHarness() {
  const value = useWebSettingsController({ prepareSurface });
  useEffect(() => {
    controller = value;
  }, [value]);
  return React.createElement("output", { "data-testid": "section" }, value.section ?? "closed");
}

beforeEach(() => {
  controller = undefined;
  prepareSurface = vi.fn().mockResolvedValue(undefined);
  delete window.seneraDesktop;
  window.history.replaceState(null, "", "/workspace");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useWebSettingsController", () => {
  it("pushes once when opening and replaces history while changing sections", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const focusTarget = document.createElement("button");
    document.body.append(focusTarget);
    focusTarget.focus();

    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller).toBeDefined());

    await act(async () => {
      await controller.openSettings("model-service", focusTarget);
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?settings=model-service");
    expect(window.history.state).toMatchObject({ [settingsHistoryStateKey]: true });
    expect(controller.returnFocusRef.current).toBe(focusTarget);
    expect(prepareSurface).toHaveBeenCalledTimes(1);

    act(() => controller.changeSection("appearance"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?settings=appearance");
    expect(controller.section).toBe("appearance");
  });

  it("keeps the workspace location stable until the settings module is ready", async () => {
    let resolveSurface;
    prepareSurface = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSurface = resolve;
        }),
    );
    const pushState = vi.spyOn(window.history, "pushState");

    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller).toBeDefined());

    let opening;
    act(() => {
      opening = controller.openSettings("appearance");
    });
    expect(controller.section).toBeNull();
    expect(window.location.search).toBe("");
    expect(pushState).not.toHaveBeenCalled();

    await act(async () => {
      resolveSurface();
      await opening;
    });
    expect(controller.section).toBe("appearance");
    expect(window.location.search).toBe("?settings=appearance");
  });

  it("does not mutate navigation when settings preparation fails", async () => {
    prepareSurface = vi.fn().mockRejectedValue(new Error("chunk unavailable"));
    const pushState = vi.spyOn(window.history, "pushState");

    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller).toBeDefined());

    await expect(controller.openSettings("about")).rejects.toThrow("chunk unavailable");
    expect(controller.section).toBeNull();
    expect(window.location.search).toBe("");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("closes a direct settings link by removing the parameter without navigating away", async () => {
    window.history.replaceState({ direct: true }, "", "/workspace?settings=about&tab=chat");
    const back = vi.spyOn(window.history, "back");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller?.section).toBe("about"));

    act(() => controller.requestClose());

    expect(back).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/workspace");
    expect(window.location.search).toBe("?tab=chat");
    expect(controller.section).toBeNull();
  });

  it("keeps direct-link close semantics after replacing its active section", async () => {
    window.history.replaceState({ direct: true }, "", "/workspace?settings=about");
    const back = vi.spyOn(window.history, "back");

    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller?.section).toBe("about"));

    act(() => controller.changeSection("appearance"));
    expect(window.history.state).toEqual({ direct: true });
    expect(window.location.search).toBe("?settings=appearance");

    act(() => controller.requestClose());
    expect(back).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(controller.section).toBeNull();
  });

  it("restores a dirty overlay after browser back and asks before abandoning it", async () => {
    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller).toBeDefined());
    await act(async () => {
      await controller.openSettings("runtime");
    });
    act(() => controller.setPendingChanges(true));

    window.history.replaceState(null, "", "/workspace");
    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })));

    expect(controller.section).toBe("runtime");
    expect(controller.closeConfirmationOpen).toBe(true);
    expect(window.location.search).toBe("?settings=runtime");
    expect(window.history.state).toMatchObject({ [settingsHistoryStateKey]: true });

    const back = vi.spyOn(window.history, "back");
    act(() => controller.confirmClose());
    expect(controller.closeConfirmationOpen).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("registers beforeunload protection only while settings contain pending changes", async () => {
    render(React.createElement(ControllerHarness));
    await waitFor(() => expect(controller).toBeDefined());
    await act(async () => {
      await controller.openSettings("storage");
    });

    const cleanEvent = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(cleanEvent)).toBe(true);

    act(() => controller.setPendingChanges(true));
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(dirtyEvent)).toBe(false);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });
});
