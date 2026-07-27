import { describe, expect, it, vi } from "vitest";
import { createRecoverableModuleLoader } from "../../../Frontend/src/lib/createRecoverableModuleLoader.ts";

describe("createRecoverableModuleLoader", () => {
  it("shares one in-flight import and retains the fulfilled module", async () => {
    let resolveModule;
    const imported = new Promise((resolve) => {
      resolveModule = resolve;
    });
    const importModule = vi.fn(() => imported);
    const loadModule = createRecoverableModuleLoader(importModule);

    const first = loadModule();
    const concurrent = loadModule();

    expect(concurrent).toBe(first);
    expect(importModule).toHaveBeenCalledTimes(1);

    resolveModule({ component: "settings" });
    await expect(first).resolves.toEqual({ component: "settings" });
    expect(loadModule()).toBe(first);
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected import so the next render can retry", async () => {
    const importModule = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ component: "recovered" });
    const loadModule = createRecoverableModuleLoader(importModule);

    await expect(loadModule()).rejects.toThrow("chunk unavailable");
    await expect(loadModule()).resolves.toEqual({ component: "recovered" });
    expect(importModule).toHaveBeenCalledTimes(2);
  });
});
