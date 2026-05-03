import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
