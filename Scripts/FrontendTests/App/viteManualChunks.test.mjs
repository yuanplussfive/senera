import { expect, test } from "vitest";

const { readVendorChunkName } = await import("../../../Frontend/src/build/viteManualChunks.ts");

test("maps frontend vendors to their intended manual chunks on Windows and POSIX paths", () => {
  expect(readVendorChunkName("/repo/node_modules/react/index.js")).toBe("vendor-react");
  expect(readVendorChunkName("/repo/node_modules/react-dom/client.js")).toBe("vendor-react");
  expect(readVendorChunkName("/repo/node_modules/scheduler/index.js")).toBe("vendor-react");
  expect(readVendorChunkName("E:\\repo\\node_modules\\@codemirror\\view\\dist\\index.js")).toBe("vendor-codemirror");
  expect(readVendorChunkName("/repo/node_modules/@uiw/react-codemirror/esm/index.js")).toBe("vendor-codemirror");
  expect(readVendorChunkName("/repo/node_modules/framer-motion/dist/es/index.mjs")).toBe("vendor-motion");
  expect(readVendorChunkName("/repo/node_modules/react-virtuoso/dist/index.mjs")).toBe("vendor-virtuoso");
  expect(readVendorChunkName("/repo/node_modules/sonner/dist/index.mjs")).toBe("vendor-sonner");
  expect(readVendorChunkName("/repo/node_modules/@radix-ui/react-dialog/dist/index.mjs")).toBe("vendor-radix");
  expect(readVendorChunkName("/repo/src/app.tsx")).toBeUndefined();
});
