import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API + ingest to the Axum backend on :8900.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:8900",
      "/batch": "http://localhost:8900",
      "/delete-request": "http://localhost:8900",
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
