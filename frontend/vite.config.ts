import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";
const wsProxyTarget = process.env.VITE_DEV_PROXY_WS_TARGET || "ws://127.0.0.1:8000";
const appVersion = process.env.npm_package_version || new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: wsProxyTarget,
        ws: true,
        changeOrigin: true,
      },
      "/media": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/static": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3001,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("jspdf") || id.includes("html2canvas")) {
            return "pdf-vendor";
          }

          if (id.includes("dompurify")) {
            return "sanitizer-vendor";
          }

          return "vendor";
        },
      },
    },
  },
});
