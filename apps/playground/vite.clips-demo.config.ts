import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The standalone clips page (clips-demo.html), built as one script and one stylesheet so
// playground/export-clips-demo.mjs can inline them into a single shareable file.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-clips-demo",
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: "clips-demo.html", output: { inlineDynamicImports: true } },
  },
});
