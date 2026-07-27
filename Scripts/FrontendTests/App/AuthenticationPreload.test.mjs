// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preloadApi = vi.hoisted(() => ({
  prepare: vi.fn(),
  preload: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("../../../Frontend/src/app/applicationModuleLoaders.ts", () => ({
  prepareAuthenticatedApplication: preloadApi.prepare,
  preloadAuthenticatedApplication: preloadApi.preload,
}));

vi.mock("../../../Frontend/src/shared/scheduling/scheduleIdleTask.ts", () => ({
  scheduleIdleTask: preloadApi.schedule,
}));

import { useAuthenticatedApplicationPreload } from "../../../Frontend/src/app/useAuthenticatedApplicationPreload.ts";

beforeEach(() => {
  vi.clearAllMocks();
  preloadApi.prepare.mockResolvedValue(undefined);
  preloadApi.schedule.mockReturnValue(vi.fn());
});

afterEach(cleanup);

describe("authenticated application preloading", () => {
  it("schedules web preloading after the first paint", () => {
    renderHook(() => useAuthenticatedApplicationPreload({ isDesktop: false, surface: "application" }));

    expect(preloadApi.schedule).toHaveBeenCalledTimes(1);
    const [scheduledTask, options] = preloadApi.schedule.mock.calls[0];
    expect(options).toEqual({ priority: "background" });
    expect(preloadApi.preload).not.toHaveBeenCalled();

    scheduledTask();
    expect(preloadApi.preload).toHaveBeenCalledWith("application");
  });

  it("starts desktop preloading only after the authentication request starts", () => {
    const { result } = renderHook(() => useAuthenticatedApplicationPreload({ isDesktop: true, surface: "settings" }));

    expect(preloadApi.schedule).not.toHaveBeenCalled();
    expect(preloadApi.preload).not.toHaveBeenCalled();

    result.current.onInitialAuthenticationRequestStarted();
    expect(preloadApi.preload).toHaveBeenCalledWith("settings");
  });

  it("reuses the authenticated route preparation for an authorized transition", async () => {
    const prepared = Promise.resolve();
    preloadApi.prepare.mockReturnValue(prepared);
    const { result } = renderHook(() => useAuthenticatedApplicationPreload({ isDesktop: false, surface: "settings" }));

    expect(result.current.prepareAuthorizedSurface()).toBe(prepared);
    expect(preloadApi.prepare).toHaveBeenCalledWith("settings");
  });

  it("cancels pending web preloading when the root unmounts", () => {
    const cancel = vi.fn();
    preloadApi.schedule.mockReturnValue(cancel);
    const { unmount } = renderHook(() =>
      useAuthenticatedApplicationPreload({ isDesktop: false, surface: "application" }),
    );

    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
