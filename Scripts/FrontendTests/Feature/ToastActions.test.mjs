// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearTestToastCalls, readTestToastCalls, toast } from "sonner";
import { installCopyableToasts } from "../../../Frontend/src/shared/ui/installCopyableToasts.ts";

beforeEach(() => {
  clearTestToastCalls();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toast actions", () => {
  test("adds copy action only to error toasts", () => {
    installCopyableToasts();

    toast.success("Saved");
    toast.info("Working");
    toast.warning("Check this");
    toast.message("Notice");
    toast.error("Request failed", { description: "Backend unavailable" });

    const calls = readTestToastCalls();
    expect(calls.slice(0, 4).every(({ options }) => !options?.action && !options?.cancel)).toBe(true);
    expect(calls[4]?.options?.action).toEqual(expect.objectContaining({ label: expect.any(String) }));
  });
});
