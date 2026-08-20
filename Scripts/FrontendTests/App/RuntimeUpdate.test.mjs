// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const desktopBridge = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("../../../Frontend/src/app/desktopBridge.ts", () => ({
  readDesktopBridge: desktopBridge.read,
  openExternalUrl: vi.fn(),
}));

import { useRuntimeUpdate } from "../../../Frontend/src/app/runtimeUpdate.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

test("keeps the desktop settings update controller available when its initial bridge probe rejects", async () => {
  const getUpdateState = vi.fn().mockRejectedValue(new Error("Update service is unavailable."));
  desktopBridge.read.mockReturnValue({
    isDesktop: true,
    getUpdateState,
    onUpdateStateChanged: vi.fn(() => vi.fn()),
  });

  const { result } = renderHook(() =>
    useRuntimeUpdate({ httpBaseUrl: "http://127.0.0.1:61972", currentVersion: "1.12.3", surface: "desktop" }),
  );

  await waitFor(() => expect(getUpdateState).toHaveBeenCalledTimes(1));
  expect(result.current.snapshot).toMatchObject({ state: "idle", currentVersion: "1.12.3", action: "none" });
});
