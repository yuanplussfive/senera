import { describe, expect, it } from "vitest";
import { readVendorChunkName } from "./viteManualChunks";

describe("readVendorChunkName", () => {
  it("matches React packages by package boundary only", () => {
    expect(readVendorChunkName("D:/app/node_modules/react/index.js")).toBe("vendor-react");
    expect(readVendorChunkName("D:/app/node_modules/react-dom/client.js")).toBe("vendor-react");
    expect(readVendorChunkName("D:/app/node_modules/scheduler/index.js")).toBe("vendor-react");
  });

  it("does not classify scoped packages containing react in their path as React", () => {
    expect(readVendorChunkName("D:/app/node_modules/@xyflow/react/dist/esm/index.js")).toBeUndefined();
  });

  it("keeps Radix packages in a separate vendor chunk", () => {
    expect(readVendorChunkName("D:/app/node_modules/@radix-ui/react-dialog/dist/index.js")).toBe("vendor-radix");
  });
});
