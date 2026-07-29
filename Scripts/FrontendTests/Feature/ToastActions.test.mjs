// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearTestToastCalls, readTestToastCalls } from "sonner";
import { notifyError } from "../../../Frontend/src/shared/ui/notifyError.ts";

beforeEach(() => {
  clearTestToastCalls();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("error toast actions", () => {
  test("ordinary errors do not expose diagnostic copying", () => {
    notifyError({ title: "Unable to save", description: "Check the highlighted fields" });

    expect(readTestToastCalls()[0]?.options?.action).toBeUndefined();
    expect(readTestToastCalls()[0]?.options?.cancel).toBeUndefined();
  });

  test("diagnostic copying is explicit and never occupies the cancel slot", () => {
    notifyError({
      title: "Tool call failed",
      description: "exit 1",
      diagnosticText: "Tool call failed\nexit 1",
      copyable: true,
    });

    const options = readTestToastCalls()[0]?.options;
    expect(options?.action).toEqual(expect.objectContaining({ label: expect.any(String) }));
    expect(options?.cancel).toBeUndefined();
  });

  test("a primary recovery action is not displaced by diagnostic copying", () => {
    const retry = { label: "Retry", onClick: vi.fn() };
    notifyError({
      title: "Request failed",
      action: retry,
      diagnosticText: "Request failed\ntrace",
      copyable: true,
    });

    const options = readTestToastCalls()[0]?.options;
    expect(options?.action).toBe(retry);
    expect(options?.cancel).toBeUndefined();
  });
});
