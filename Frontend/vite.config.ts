import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readVendorChunkName } from "./src/build/viteManualChunks";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return readVendorChunkName(id);
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
